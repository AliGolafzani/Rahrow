// Inert synthetic values only. This fixture never creates or records real OTPs or session bearers.
export const mobile = '+12025550123';
export const challengeId = '00000000-0000-4000-8000-000000000001';
export const correlationId = '00000000-0000-4000-8000-000000000002';
export const expiresAt = '2030-01-01T01:00:00.000Z';
export const requested = { challengeId, expiresAt, retryAfterSeconds: 60 };
export const user = { id: 'fixture-user', mobile, email: null, firstName: null, lastName: null,
  birthDate: null, displayName: null, avatar: null };
export const authenticated = { user, session: { expiresAt } };
export const rotated = { session: { expiresAt } };
export const sessionCookie = '__Host-rahrow_session=nonsecret-fixture; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=3600; Expires=Tue, 01 Jan 2030 01:00:00 GMT';
export const clearedCookie = '__Host-rahrow_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
export function failure(code = 'AUTH_UNAVAILABLE', extra = {}) {
  return { error: { code, message: 'Synthetic upstream diagnostic must not enter the UI.', correlationId, ...extra } };
}
