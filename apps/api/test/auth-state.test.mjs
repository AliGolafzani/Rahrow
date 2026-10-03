import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { AuthRepository } from '../dist/modules/auth/auth.repository.js';
import { createSessionToken } from '../dist/modules/auth/auth.security.js';

test('session resolution accepts only repository-validated mobile assurance and discloses no verifier', async () => {
  const token = createSessionToken();
  const service = new AuthService({ findMobileSession: async digest => {
    assert.equal(digest, token.digest);
    return { id: 'session', userId: 'user', tokenDigest: 'private', expiresAt: new Date() };
  } });
  assert.deepEqual(await service.resolveSession(token.token), { userId: 'user', sessionId: 'session', authenticationMethod: 'MOBILE_OTP' });
  assert.equal(await service.resolveSession('bad'), null);
  assert.equal(await new AuthService({ findMobileSession: async () => null }).resolveSession(token.token), null);
  assert.equal(typeof service.issueSession, 'undefined');
  assert.equal(typeof service.issueAdminSession, 'undefined');
});

test('repository filters expired/revoked/admin sessions and excludes role-derived assurance', async () => {
  const now = new Date();
  const repository = new AuthRepository({ client: { authSession: { findFirst: async query => {
    assert.deepEqual(query.where, { tokenDigest: 'digest', revokedAt: null, expiresAt: { gt: now }, authenticationMethod: 'MOBILE_OTP' });
    assert.deepEqual(query.select, { id: true, userId: true, expiresAt: true });
    return null;
  } } } });
  assert.equal(await repository.findMobileSession('digest', now), null);
});

test('rotation returns a raw token once, only when atomic repository rotation succeeds', async () => {
  const old = createSessionToken();
  const expiry = new Date();
  const service = new AuthService({ rotateMobileSession: async (digest, nextDigest) => {
    assert.equal(digest, old.digest);
    assert.notEqual(nextDigest, digest);
    return { expiresAt: expiry };
  } });
  const rotated = await service.rotateSession(old.token);
  assert.equal(rotated.expiresAt, expiry);
  assert.notEqual(rotated.token, old.token);
  assert.deepEqual(Object.keys(rotated).sort(), ['expiresAt', 'token']);
  assert.equal(await new AuthService({ rotateMobileSession: async () => null }).rotateSession(old.token), null);
});

test('invalid rate-limit and replay settings fail before database access', async () => {
  const repository = new AuthRepository({});
  await assert.rejects(repository.advanceTotpReplayCounter('user', -1n), /Invalid replay counter/);
  await assert.rejects(repository.useRateLimit({ bucketKey: 'raw-phone', scope: 'otp-verification', limit: 5, windowStart: new Date(0), expiresAt: new Date(Date.now() + 1000) }), /Invalid rate-limit configuration/);
});

test('OTP expiry is evaluated after the challenge row lock resolves', async () => {
  let time = 100;
  let writes = 0;
  const transaction = {
    $queryRaw: async () => { time = 300; return [{ id: 'challenge', targetDigest: 'digest', codeMac: 'mac', expiresAt: new Date(200), consumedAt: null, failedAttempts: 0, attemptLimit: 5 }]; },
    otpChallenge: { update: async () => { writes++; } },
  };
  const repository = new AuthRepository({ client: { $transaction: async fn => fn(transaction) } });
  assert.equal(await repository.consumeOtp('challenge', 'digest', '123456', { verifyCode: () => true }, () => new Date(time)), false);
  assert.equal(writes, 0);
});

test('session rotation rechecks expiry after locking, without revoking or creating on expiry', async () => {
  let time = 100;
  let writes = 0;
  const transaction = {
    $queryRaw: async () => { time = 300; return [{ id: 'session', userId: 'user', authenticationMethod: 'MOBILE_OTP', revokedAt: null, expiresAt: new Date(200) }]; },
    authSession: { update: async () => { writes++; }, create: async () => { writes++; } },
  };
  const repository = new AuthRepository({ client: { $transaction: async fn => fn(transaction) } });
  assert.equal(await repository.rotateMobileSession('old', 'new', () => new Date(time)), null);
  assert.equal(writes, 0);
});

test('session lookup and rate-limit admission reject expiry during database waits', async () => {
  let time = 100;
  const clock = () => new Date(time);
  const repository = new AuthRepository({ client: {
    authSession: { findFirst: async () => { time = 300; return { id: 'session', userId: 'user', expiresAt: new Date(200) }; } },
    $queryRaw: async () => { time = 300; return [{ count: 1 }]; },
  } });
  assert.equal(await repository.findMobileSession('digest', clock), null);
  time = 100;
  assert.equal(await repository.useRateLimit({ bucketKey: 'a'.repeat(64), scope: 'otp-verification', windowStart: new Date(0), expiresAt: new Date(200), limit: 5 }, clock), false);
});
