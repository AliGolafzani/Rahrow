import type { AuthConfig } from './auth.config.js';
import { AuthHttpError } from './auth.errors.js';
import { digestSessionToken } from './auth.security.js';

type CookieConfiguration = Pick<AuthConfig, 'cookieName' | 'cookieSecure'>;
export interface CookieRequest { headers?: { cookie?: unknown } }

/** One canonical cookie source. Authorization headers and forged request identity are ignored. */
export function readSessionCookie(request: CookieRequest, configuration: CookieConfiguration): string | null {
  const header = request.headers?.cookie;
  if (header === undefined) return null;
  if (typeof header !== 'string' || header.length > 8192) throw new AuthHttpError('AUTH_INVALID_INPUT');
  const matches = header.split(';').map(part => part.trim()).filter(part => {
    const equals = part.indexOf('=');
    return (equals < 0 ? part : part.slice(0, equals).trim()) === configuration.cookieName;
  });
  if (matches.length > 1) throw new AuthHttpError('AUTH_INVALID_INPUT');
  if (matches.length === 0) return null;
  const separator = matches[0].indexOf('=');
  if (separator < 0) return null;
  const token = matches[0].slice(separator + 1);
  try { digestSessionToken(token); return token; } catch { return null; }
}

function cookieFlags(configuration: CookieConfiguration): string {
  return `Path=/; HttpOnly; SameSite=Lax${configuration.cookieSecure ? '; Secure' : ''}`;
}
export function sessionCookie(configuration: CookieConfiguration, token: string, expiresAt: Date, now = new Date()): string {
  digestSessionToken(token);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) throw new AuthHttpError('AUTH_SESSION_EXPIRED');
  return `${configuration.cookieName}=${token}; ${cookieFlags(configuration)}; Expires=${expiresAt.toUTCString()}; Max-Age=${Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))}`;
}
export function clearSessionCookie(configuration: CookieConfiguration): string {
  return `${configuration.cookieName}=; ${cookieFlags(configuration)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
}
