import type { AuthenticatedSession, AuthErrorEnvelope, RequestedOtp, RotatedSession } from '@rahrow/contracts';

export const AUTH_CODES = ['AUTH_INVALID_INPUT', 'AUTH_REQUEST_FORBIDDEN', 'AUTH_THROTTLED', 'AUTH_OTP_INVALID',
  'AUTH_OTP_EXPIRED', 'AUTH_OTP_EXHAUSTED', 'AUTH_OTP_CONSUMED', 'AUTH_SESSION_INVALID',
  'AUTH_SESSION_EXPIRED', 'AUTH_DELIVERY_UNAVAILABLE', 'AUTH_UNAVAILABLE'] as const;
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
function date(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function nullableString(value: unknown): boolean { return value === null || (typeof value === 'string' && value.length <= 2048); }
export function isRetrySeconds(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 86400; }
export function isRequestedOtp(value: unknown): value is RequestedOtp {
  return record(value) && keys(value, ['challengeId', 'expiresAt', 'retryAfterSeconds']) &&
    typeof value.challengeId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.challengeId) &&
    date(value.expiresAt) && isRetrySeconds(value.retryAfterSeconds);
}
export function isRotatedSession(value: unknown): value is RotatedSession {
  return record(value) && keys(value, ['session']) && record(value.session) && keys(value.session, ['expiresAt']) && date(value.session.expiresAt);
}
export function isAuthenticatedSession(value: unknown): value is AuthenticatedSession {
  if (!record(value) || !keys(value, ['user', 'session']) || !isRotatedSession({ session: value.session }) || !record(value.user)) return false;
  const user = value.user;
  return keys(user, ['id', 'mobile', 'email', 'firstName', 'lastName', 'birthDate', 'displayName', 'avatar']) &&
    typeof user.id === 'string' && user.id.length > 0 && user.id.length <= 128 &&
    typeof user.mobile === 'string' && /^\+[1-9][0-9]{0,14}$/.test(user.mobile) &&
    ['email', 'firstName', 'lastName', 'displayName', 'avatar'].every(key => nullableString(user[key])) &&
    (user.birthDate === null || (typeof user.birthDate === 'string' && /^\d{4}-\d\d-\d\d$/.test(user.birthDate) && date(`${user.birthDate}T00:00:00.000Z`)));
}
export function isAuthError(value: unknown): value is AuthErrorEnvelope {
  if (!record(value) || !keys(value, ['error']) || !record(value.error)) return false;
  const error = value.error;
  return keys(error, error.retryAfterSeconds === undefined ? ['code', 'message', 'correlationId'] : ['code', 'message', 'correlationId', 'retryAfterSeconds']) &&
    AUTH_CODES.some(code => code === error.code) && typeof error.message === 'string' && error.message.length <= 256 &&
    typeof error.correlationId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(error.correlationId) &&
    (error.retryAfterSeconds === undefined || isRetrySeconds(error.retryAfterSeconds));
}
