import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { OtpMac } from './auth.security.js';
import { AuthHttpError } from './auth.errors.js';

export interface AuthRateBudget { readonly limit: number; readonly windowMs: number }
export interface AuthRateLimits {
  readonly requestTarget: readonly AuthRateBudget[];
  readonly requestIp: readonly AuthRateBudget[];
  readonly verifyChallenge: readonly AuthRateBudget[];
  readonly verifyTarget: readonly AuthRateBudget[];
  readonly verifyIp: readonly AuthRateBudget[];
  readonly selfSession: readonly AuthRateBudget[];
  readonly selfIp: readonly AuthRateBudget[];
  readonly rotateFamily: readonly AuthRateBudget[];
  readonly rotateIp: readonly AuthRateBudget[];
  readonly logoutIp: readonly AuthRateBudget[];
}

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = Object.freeze({
  requestTarget: [{ limit: 3, windowMs: 900_000 }, { limit: 10, windowMs: 3_600_000 }],
  requestIp: [{ limit: 30, windowMs: 900_000 }, { limit: 100, windowMs: 3_600_000 }],
  verifyChallenge: [{ limit: 10, windowMs: 60_000 }],
  verifyTarget: [{ limit: 15, windowMs: 900_000 }],
  verifyIp: [{ limit: 100, windowMs: 900_000 }],
  selfSession: [{ limit: 120, windowMs: 60_000 }],
  selfIp: [{ limit: 300, windowMs: 60_000 }],
  rotateFamily: [{ limit: 6, windowMs: 60_000 }],
  rotateIp: [{ limit: 30, windowMs: 60_000 }],
  logoutIp: [{ limit: 60, windowMs: 60_000 }],
});

export interface AuthConfigOptions {
  readonly mode?: 'unconfigured' | 'local' | 'test';
  readonly nodeEnv?: string;
  readonly host?: string;
  readonly allowedOrigins?: readonly string[];
  readonly localCookie?: boolean;
  readonly key?: Uint8Array;
  readonly otpLifetimeMs?: number;
  readonly otpAttemptLimit?: number;
  readonly otpCooldownMs?: number;
  readonly otpMaxActiveChallenges?: number;
  readonly sessionLifetimeMs?: number;
  readonly deliveryTimeoutMs?: number;
  readonly rateLimits?: Partial<AuthRateLimits>;
  readonly clock?: () => Date;
}

function invalid(): never { throw new Error('Authentication configuration is unsafe or invalid.'); }
function integer(value: number | undefined, fallback: number, min: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) invalid();
  return result;
}
function environmentNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value)) invalid();
  return Number(value);
}
function environmentOptions(): AuthConfigOptions {
  const mode = process.env.AUTH_MODE ?? 'unconfigured';
  if (!['unconfigured', 'local', 'test'].includes(mode)) invalid();
  const cookie = process.env.AUTH_COOKIE_MODE ?? 'secure';
  if (!['secure', 'local'].includes(cookie)) invalid();
  let rateLimits: Partial<AuthRateLimits> | undefined;
  if (process.env.AUTH_RATE_LIMITS !== undefined) {
    try { rateLimits = JSON.parse(process.env.AUTH_RATE_LIMITS) as Partial<AuthRateLimits>; } catch { invalid(); }
  }
  return {
    mode: mode as AuthConfigOptions['mode'], nodeEnv: process.env.NODE_ENV,
    host: process.env.HOST ?? '127.0.0.1', localCookie: cookie === 'local',
    allowedOrigins: process.env.AUTH_ALLOWED_ORIGINS?.split(','), rateLimits,
    otpLifetimeMs: environmentNumber(process.env.AUTH_OTP_LIFETIME_MS),
    otpAttemptLimit: environmentNumber(process.env.AUTH_OTP_ATTEMPT_LIMIT),
    otpCooldownMs: environmentNumber(process.env.AUTH_OTP_COOLDOWN_MS),
    otpMaxActiveChallenges: environmentNumber(process.env.AUTH_OTP_MAX_ACTIVE_CHALLENGES),
    sessionLifetimeMs: environmentNumber(process.env.AUTH_SESSION_LIFETIME_MS),
    deliveryTimeoutMs: environmentNumber(process.env.AUTH_DELIVERY_TIMEOUT_MS),
  };
}

/** Local-only activation; no key fallback or production provider is configured. */
@Injectable()
export class AuthConfig {
  readonly mode: 'unconfigured' | 'local' | 'test';
  readonly configured: boolean;
  readonly allowedOrigins: readonly string[];
  readonly cookieName: '__Host-rahrow_session' | 'rahrow_local_session';
  readonly cookieSecure: boolean;
  readonly cookieLocal: boolean;
  readonly otpLifetimeMs: number;
  readonly otpAttemptLimit: number;
  readonly otpCooldownMs: number;
  readonly otpMaxActiveChallenges: number;
  readonly sessionLifetimeMs: number;
  readonly deliveryTimeoutMs: number;
  readonly rateLimits: AuthRateLimits;
  readonly #mac: OtpMac | undefined;
  readonly #clock: () => Date;

  constructor(options: AuthConfigOptions = environmentOptions()) {
    this.mode = options.mode ?? 'unconfigured';
    if (!['unconfigured', 'local', 'test'].includes(this.mode)) invalid();
    this.configured = this.mode !== 'unconfigured';
    const loopback = ['127.0.0.1', '::1', 'localhost'].includes(options.host ?? '127.0.0.1');
    const production = (options.nodeEnv ?? process.env.NODE_ENV) === 'production';
    this.cookieLocal = options.localCookie ?? false;
    if ((this.configured || this.cookieLocal) && (production || !loopback)) invalid();
    this.cookieSecure = !this.cookieLocal;
    this.cookieName = this.cookieLocal ? 'rahrow_local_session' : '__Host-rahrow_session';
    const origins = options.allowedOrigins ?? [];
    if (!Array.isArray(origins) || origins.length > 10 || (this.configured && origins.length === 0)) invalid();
    this.allowedOrigins = Object.freeze(origins.map(origin => {
      if (typeof origin !== 'string' || origin.length > 512) invalid();
      let url: URL;
      try { url = new URL(origin); } catch { invalid(); }
      if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid();
      // Fake OTP and insecure local cookies may not be exposed to remote browser origins.
      if ((this.configured || this.cookieLocal) && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) invalid();
      return origin;
    }));
    this.otpLifetimeMs = integer(options.otpLifetimeMs, 300_000, 100, 3_600_000);
    this.otpAttemptLimit = integer(options.otpAttemptLimit, 5, 1, 20);
    this.otpCooldownMs = integer(options.otpCooldownMs, 60_000, 0, 3_600_000);
    this.otpMaxActiveChallenges = integer(options.otpMaxActiveChallenges, 5, 1, 100);
    this.sessionLifetimeMs = integer(options.sessionLifetimeMs, 43_200_000, 100, 604_800_000);
    this.deliveryTimeoutMs = integer(options.deliveryTimeoutMs, 2_000, 1, 10_000);
    const overrides = options.rateLimits ?? {};
    if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides) ||
      Object.keys(overrides).some(key => !(key in DEFAULT_AUTH_RATE_LIMITS))) invalid();
    this.rateLimits = Object.freeze(Object.fromEntries(Object.entries(DEFAULT_AUTH_RATE_LIMITS).map(([name, defaults]) => {
      const budgets = overrides[name as keyof AuthRateLimits] ?? defaults;
      if (!Array.isArray(budgets) || budgets.length === 0 || budgets.length > 4) invalid();
      return [name, Object.freeze(budgets.map(budget => {
        if (!budget || Object.keys(budget).some(key => !['limit', 'windowMs'].includes(key))) invalid();
        return Object.freeze({ limit: integer(budget.limit, 0, 1, 10_000), windowMs: integer(budget.windowMs, 0, 1_000, 86_400_000) });
      }))];
    })) as unknown as AuthRateLimits);
    this.#clock = options.clock ?? (() => new Date());
    if (this.configured) {
      // A local restart deliberately invalidates outstanding MACs. Never serialize/log the key.
      const key = options.key ?? randomBytes(32);
      this.#mac = new OtpMac(key);
      if (!options.key) key.fill(0);
    }
    Object.freeze(this);
  }

  assertAvailable(): void { if (!this.configured) throw new AuthHttpError('AUTH_UNAVAILABLE'); }
  get mac(): OtpMac { this.assertAvailable(); return this.#mac!; }
  now(): Date {
    const now = this.#clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new AuthHttpError('AUTH_UNAVAILABLE');
    return new Date(now);
  }
}
