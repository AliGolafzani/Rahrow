import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedSelf } from '@rahrow/contracts';
import { UsersRepository } from '../users/users.repository.js';
import { AuditRepository } from '../audit/audit.repository.js';
import { AuthConfig } from './auth.config.js';
import { AuthHttpError } from './auth.errors.js';
import { AuthRateLimiter } from './auth.rate-limits.js';
import { AuthRepository } from './auth.repository.js';
import { SessionResult } from './auth.service.js';
import { assertCanonicalMobile, createSessionToken, digestSessionToken, generateOtpCode } from './auth.security.js';
import { OtpDeliveryProvider, type OtpDelivery } from './otp-delivery.provider.js';

/** The bearer is deliberately absent from JSON/inspection and is only read by cookie transport. */
class VerifiedSessionResult {
  readonly user: AuthenticatedSelf;
  readonly expiresAt: Date;
  readonly #token: string;
  constructor(user: AuthenticatedSelf, expiresAt: Date, token: string) {
    this.user = user;
    this.expiresAt = expiresAt;
    this.#token = token;
    Object.freeze(this);
  }
  get token(): string { return this.#token; }
}

@Injectable()
export class MobileOtpService {
  readonly #limiter: AuthRateLimiter;
  constructor(
    private readonly repository: AuthRepository,
    private readonly users: UsersRepository,
    private readonly audit: AuditRepository,
    private readonly config: AuthConfig,
    private readonly delivery: OtpDeliveryProvider,
  ) { this.#limiter = new AuthRateLimiter(repository, config); }

  #mobile(value: unknown): string {
    try { return assertCanonicalMobile(value); } catch { throw new AuthHttpError('AUTH_INVALID_INPUT'); }
  }
  #digest(token: string): string {
    try { return digestSessionToken(token); } catch { throw new AuthHttpError('AUTH_SESSION_INVALID'); }
  }
  #ip(ip: string): string { return typeof ip === 'string' && ip.length > 0 && ip.length <= 128 ? ip : 'unavailable'; }
  #correlation(value?: string): string {
    if (value !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new AuthHttpError('AUTH_INVALID_INPUT');
    }
    return value ?? randomUUID();
  }
  async #safe<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      if (error instanceof AuthHttpError) throw error;
      throw new AuthHttpError('AUTH_UNAVAILABLE');
    }
  }

  async #deliver(input: Omit<OtpDelivery, 'signal'>): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.delivery.deliver({ ...input, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new AuthHttpError('AUTH_DELIVERY_UNAVAILABLE')); }, this.config.deliveryTimeoutMs);
        }),
      ]);
    } catch { throw new AuthHttpError('AUTH_DELIVERY_UNAVAILABLE'); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }

  async requestOtp(input: { mobile: string }, ip: string, correlationId?: string) {
    this.config.assertAvailable();
    const mobile = this.#mobile(input?.mobile);
    const correlation = this.#correlation(correlationId);
    const targetDigest = this.config.mac.targetDigest(mobile);
    await this.#limiter.admit([['requestIp', this.#ip(ip)], ['requestTarget', targetDigest]]);
    return this.#safe(() => this.repository.withTransaction(async transaction => {
      await this.repository.lockOtpTarget(transaction, targetDigest);
      const availability = await this.repository.otpRequestAvailability(transaction, {
        targetDigest, cooldownMs: this.config.otpCooldownMs, maxActiveChallenges: this.config.otpMaxActiveChallenges,
      }, () => this.config.now());
      if (!availability.allowed) throw new AuthHttpError('AUTH_THROTTLED', availability.retryAfterSeconds);
      const createdAt = this.config.now();
      const expiresAt = new Date(createdAt.getTime() + this.config.otpLifetimeMs);
      const challengeId = randomUUID();
      const code = generateOtpCode();
      await this.repository.createOtpChallenge(transaction, {
        id: challengeId, targetDigest, codeMac: this.config.mac.codeMac({ challengeId, targetDigest }, code),
        createdAt, expiresAt, attemptLimit: this.config.otpAttemptLimit,
      });
      await this.#deliver({ challengeId, target: mobile, code, expiresAt });
      await this.audit.append(transaction, {
        actorId: null, action: 'auth.otp.requested', entityType: 'OtpChallenge', entityId: challengeId,
        beforeSummary: { exists: false }, afterSummary: { exists: true, attemptLimit: this.config.otpAttemptLimit }, correlationId: correlation,
      });
      return { challengeId, expiresAt, retryAfterSeconds: Math.ceil(this.config.otpCooldownMs / 1_000) };
    }, { timeoutMs: this.config.deliveryTimeoutMs + 5_000 }));
  }

  async verifyOtp(input: { challengeId: string; mobile: string; code: string }, ip: string, correlationId?: string): Promise<VerifiedSessionResult> {
    this.config.assertAvailable();
    const mobile = this.#mobile(input?.mobile);
    if (typeof input.challengeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.challengeId) ||
      typeof input.code !== 'string' || !/^[0-9]{6}$/.test(input.code)) throw new AuthHttpError('AUTH_INVALID_INPUT');
    const correlation = this.#correlation(correlationId);
    const challengeId = input.challengeId.toLowerCase();
    const targetDigest = this.config.mac.targetDigest(mobile);
    await this.#limiter.admit([['verifyIp', this.#ip(ip)], ['verifyTarget', targetDigest], ['verifyChallenge', challengeId]]);
    const result = await this.#safe(() => this.repository.withTransaction(async transaction => {
      const consumption = await this.repository.consumeOtpInTransaction(transaction, challengeId, targetDigest, input.code, this.config.mac, () => this.config.now());
      if (consumption.status !== 'consumed') {
        if (consumption.failedAttempts !== undefined && consumption.previousFailedAttempts !== undefined) {
          await this.audit.append(transaction, {
            actorId: null, action: 'auth.otp.failed', entityType: 'OtpChallenge', entityId: challengeId,
            beforeSummary: { failedAttempts: consumption.previousFailedAttempts },
            afterSummary: { failedAttempts: consumption.failedAttempts, outcome: consumption.status === 'already-consumed' ? 'consumed' : consumption.status },
            correlationId: correlation,
          });
        }
        // Return, rather than throw, so failed-attempt updates and their audit commit.
        return { failure: consumption.status } as const;
      }
      const { user, created } = await this.users.findOrCreateMobile(transaction, mobile, () => this.config.now());
      const now = this.config.now();
      // A uniqueness wait can outlive the challenge. Roll back tentative consumption/user creation.
      if (consumption.expiresAt <= now) throw new AuthHttpError('AUTH_OTP_EXPIRED');
      const token = createSessionToken();
      const expiresAt = new Date(now.getTime() + this.config.sessionLifetimeMs);
      const session = await this.repository.issueMobileSession(transaction, { userId: user.id, tokenDigest: token.digest, expiresAt }, () => this.config.now());
      await this.audit.append(transaction, {
        actorId: user.id, action: 'auth.otp.consumed', entityType: 'OtpChallenge', entityId: challengeId,
        beforeSummary: { consumed: false }, afterSummary: { consumed: true }, correlationId: correlation,
      });
      if (created) await this.audit.append(transaction, {
        actorId: user.id, action: 'auth.user.created', entityType: 'User', entityId: user.id,
        beforeSummary: { exists: false }, afterSummary: { exists: true }, correlationId: correlation,
      });
      await this.audit.append(transaction, {
        actorId: user.id, action: 'auth.session.issued', entityType: 'AuthSession', entityId: session.id,
        beforeSummary: { active: false }, afterSummary: { active: true, authenticationMethod: 'MOBILE_OTP' }, correlationId: correlation,
      });
      if (consumption.expiresAt <= this.config.now()) throw new AuthHttpError('AUTH_OTP_EXPIRED');
      return { success: new VerifiedSessionResult(user, session.expiresAt, token.token) } as const;
    }));
    if (result.success !== undefined) return result.success;
    const codes = { invalid: 'AUTH_OTP_INVALID', expired: 'AUTH_OTP_EXPIRED', exhausted: 'AUTH_OTP_EXHAUSTED', 'already-consumed': 'AUTH_OTP_CONSUMED' } as const;
    throw new AuthHttpError(codes[result.failure]);
  }

  async currentSession(token: string, ip: string, _correlationId?: string) {
    void _correlationId;
    this.config.assertAvailable();
    await this.#limiter.admit([['selfIp', this.#ip(ip)]]);
    const digest = this.#digest(token);
    return this.#safe(async () => {
      const result = await this.repository.lookupMobileSession(digest, () => this.config.now());
      if (result.status !== 'valid') throw new AuthHttpError(result.status === 'expired' ? 'AUTH_SESSION_EXPIRED' : 'AUTH_SESSION_INVALID');
      const { session } = result;
      await this.#limiter.admit([['selfSession', session.id]]);
      const user = await this.users.authenticatedSelf(session.userId);
      if (!user) throw new AuthHttpError('AUTH_SESSION_INVALID');
      if (session.expiresAt <= this.config.now()) throw new AuthHttpError('AUTH_SESSION_EXPIRED');
      // Re-resolve after profile lookup so a revoke during the wait cannot return an authorized self.
      const current = await this.repository.lookupMobileSession(digest, () => this.config.now());
      if (current.status !== 'valid') throw new AuthHttpError(current.status === 'expired' ? 'AUTH_SESSION_EXPIRED' : 'AUTH_SESSION_INVALID');
      return { user, expiresAt: session.expiresAt };
    });
  }

  async rotateSession(token: string, ip: string, correlationId?: string) {
    this.config.assertAvailable();
    await this.#limiter.admit([['rotateIp', this.#ip(ip)]]);
    const digest = this.#digest(token);
    const correlation = this.#correlation(correlationId);
    return this.#safe(async () => {
      const family = await this.repository.findSessionFamily(digest);
      if (!family) throw new AuthHttpError('AUTH_SESSION_INVALID');
      await this.#limiter.admit([['rotateFamily', family.rootId]]);
      const current = await this.repository.lookupMobileSession(digest, () => this.config.now());
      if (current.status !== 'valid') throw new AuthHttpError(current.status === 'expired' ? 'AUTH_SESSION_EXPIRED' : 'AUTH_SESSION_INVALID');
      const next = createSessionToken();
      const session = await this.repository.rotateMobileSession(digest, next.digest, () => this.config.now(), correlation);
      if (!session) throw new AuthHttpError('AUTH_SESSION_INVALID');
      return new SessionResult(next.token, session.expiresAt);
    });
  }

  async logout(token: string | null, ip: string, correlationId?: string): Promise<void> {
    this.config.assertAvailable();
    await this.#limiter.admit([['logoutIp', this.#ip(ip)]]);
    if (token === null) return;
    let digest: string;
    try { digest = digestSessionToken(token); } catch { return; }
    const correlation = this.#correlation(correlationId);
    await this.#safe(() => this.repository.revokeSession(digest, () => this.config.now(), correlation));
  }
}
