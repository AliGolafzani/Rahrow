import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTH_CODES, record, isRetrySeconds, isRequestedOtp, isAuthenticatedSession, isRotatedSession, isAuthError } from '../src/lib/auth/contracts.ts';
import { authenticated, requested, rotated, failure, expiresAt } from './auth-fixtures.mjs';

const copy = value => globalThis.structuredClone(value);

test('runtime DTO validators accept the exact AUTH02 projections including null profile fields', () => {
  assert.equal(record({}), true);
  for (const value of [null, undefined, [], '', 1, true]) assert.equal(record(value), false);
  assert.equal(isRequestedOtp(requested), true);
  assert.equal(isAuthenticatedSession(authenticated), true);
  assert.equal(isRotatedSession(rotated), true);
  for (const code of AUTH_CODES) assert.equal(isAuthError(failure(code)), true);
  const withProfile = copy(authenticated);
  Object.assign(withProfile.user, { firstName: 'نام', lastName: 'کاربر', email: 'fixture@example.invalid',
    displayName: 'کاربر', avatar: '/profile-fixture.png', birthDate: '2000-02-29' });
  assert.equal(isAuthenticatedSession(withProfile), true);
});

test('all exact response projections reject missing fields, extra fields and credential-bearing expansion', () => {
  for (const [validator, dto] of [[isRequestedOtp, requested], [isAuthenticatedSession, authenticated], [isRotatedSession, rotated], [isAuthError, failure()]]) {
    for (const value of [null, [], 1, 'response', {}, { ...dto, extra: true }, { ...dto, token: 'nonsecret-fixture' }]) {
      assert.equal(validator(value), false);
    }
    for (const key of Object.keys(dto)) { const value = copy(dto); delete value[key]; assert.equal(validator(value), false); }
  }
  for (const key of Object.keys(authenticated.user)) {
    const value = copy(authenticated); delete value.user[key]; assert.equal(isAuthenticatedSession(value), false);
  }
  for (const key of ['role', 'permissions', 'status', 'credential', 'token', 'isNewUser', 'profileComplete']) {
    const value = copy(authenticated); value.user[key] = 'nonsecret-fixture'; assert.equal(isAuthenticatedSession(value), false);
  }
  assert.equal(isAuthenticatedSession({ ...authenticated, session: { ...authenticated.session, token: 'nonsecret-fixture' } }), false);
  assert.equal(isRotatedSession({ session: { ...rotated.session, token: 'nonsecret-fixture' } }), false);
  assert.equal(isAuthError({ error: { ...failure().error, debug: 'unexpected' } }), false);
});

test('retry guidance is an integer in the bounded nonnegative interval', () => {
  for (const value of [0, 1, 60, 86400]) {
    assert.equal(isRetrySeconds(value), true);
    assert.equal(isRequestedOtp({ ...requested, retryAfterSeconds: value }), true);
    assert.equal(isAuthError(failure('AUTH_THROTTLED', { retryAfterSeconds: value })), true);
  }
  for (const value of [-1, 0.1, 86401, Infinity, NaN, '60', null, undefined]) {
    assert.equal(isRetrySeconds(value), false);
    assert.equal(isRequestedOtp({ ...requested, retryAfterSeconds: value }), false);
    assert.equal(isAuthError(failure('AUTH_THROTTLED', { retryAfterSeconds: value })), false);
  }
});

test('challenge, expiry, correlation and error fields are bounded and do not coerce input', () => {
  for (const challengeId of ['', 'not-uuid', 1, null, '00000000-0000-4000-8000-000000000001 ']) {
    assert.equal(isRequestedOtp({ ...requested, challengeId }), false);
  }
  for (const value of ['', '2030-01-01', '2030-01-01T01:00:00Z', '2030-01-01T01:00:00.000+00:00', 'not-a-date', 1, null]) {
    assert.equal(isRequestedOtp({ ...requested, expiresAt: value }), false);
    assert.equal(isRotatedSession({ session: { expiresAt: value } }), false);
  }
  for (const patch of [{ code: 'UNKNOWN' }, { message: {} }, { message: 'x'.repeat(257) },
    { correlationId: '' }, { correlationId: 'not-uuid' }, { correlationId: 1 }]) {
    assert.equal(isAuthError({ error: { ...failure().error, ...patch } }), false);
  }
  assert.equal(isRequestedOtp({ ...requested, expiresAt }), true);
});

test('authenticated mobile matches the backend one-to-fifteen digit canonical contract', () => {
  for (const mobile of ['+1', '+12', '+123456789012345']) {
    assert.equal(isAuthenticatedSession({ ...authenticated, user: { ...authenticated.user, mobile } }), true);
  }
  for (const mobile of ['', '+', '+0', '+012', '+1234567890123456', '12025550123', '+۱۲۰۲', '+12 3', '+123\n', 12]) {
    assert.equal(isAuthenticatedSession({ ...authenticated, user: { ...authenticated.user, mobile } }), false);
  }
});

test('private self fields remain exact, nullable strings with bounded identifiers and date-only birth date', () => {
  for (const id of ['', 1, null, 'x'.repeat(129)]) {
    assert.equal(isAuthenticatedSession({ ...authenticated, user: { ...authenticated.user, id } }), false);
  }
  for (const key of ['email', 'firstName', 'lastName', 'displayName', 'avatar']) {
    for (const value of [1, {}, [], 'x'.repeat(2049)]) {
      assert.equal(isAuthenticatedSession({ ...authenticated, user: { ...authenticated.user, [key]: value } }), false);
    }
  }
  for (const birthDate of [1, '', '2000-1-01', '2000-01-01T00:00:00.000Z']) {
    assert.equal(isAuthenticatedSession({ ...authenticated, user: { ...authenticated.user, birthDate } }), false);
  }
});


test('canonical calendar validation rejects impossible dates rather than normalizing them', () => {
  for (const value of ['2030-02-30T01:00:00.000Z', '2030-04-31T01:00:00.000Z', '2030-01-01T24:00:00.000Z']) {
    assert.equal(isRequestedOtp({ ...requested, expiresAt: value }), false);
    assert.equal(isRotatedSession({ session: { expiresAt: value } }), false);
  }
  for (const birthDate of ['2001-02-29', '2000-02-30', '2000-04-31', '2000-00-01', '2000-01-00']) {
    assert.equal(isAuthenticatedSession({ ...authenticated, user: { ...authenticated.user, birthDate } }), false);
  }
});
