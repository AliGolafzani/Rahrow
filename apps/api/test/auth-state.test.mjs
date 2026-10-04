import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
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

test('rotation exposes a token only through its redacted internal envelope after atomic success', async () => {
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
  assert.deepEqual(Object.keys(rotated), ['expiresAt']);
  assert.deepEqual(JSON.parse(JSON.stringify(rotated)), { expiresAt: expiry.toISOString() });
  assert.ok(!inspect(rotated).includes(rotated.token));
  assert.ok(!JSON.stringify({ nested: rotated }).includes(rotated.token));
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


test('logout rejects malformed tokens but propagates actual revocation persistence failure', async () => {
  const failure = new Error('simulated persistence failure');
  const service = new AuthService({ revokeSession: async () => { throw failure; } });
  assert.equal(await service.revokeSession('malformed'), false);
  await assert.rejects(service.revokeSession(createSessionToken().token), error => error === failure);
});

test('OTP transaction helper commits wrong attempts normally and hides mismatched target state', async () => {
  let writes = 0;
  let committed = false;
  const challenge = { id: randomUUID(), targetDigest: 'target', codeMac: 'private', expiresAt: new Date(200), consumedAt: null, failedAttempts: 0, attemptLimit: 5 };
  const transaction = {
    $queryRaw: async () => [{ ...challenge }],
    otpChallenge: { update: async query => { writes++; challenge.failedAttempts += query.data.failedAttempts.increment; } },
  };
  const repository = new AuthRepository({ client: { $transaction: async fn => { const result = await fn(transaction); committed = true; return result; } } });
  const wrong = await repository.withTransaction(tx => repository.consumeOtpInTransaction(tx, challenge.id, 'target', '000000', { verifyCode: () => false }, new Date(100)));
  assert.deepEqual(wrong, { status: 'invalid', previousFailedAttempts: 0, failedAttempts: 1 });
  assert.equal(committed, true);
  assert.equal(writes, 1);
  challenge.consumedAt = new Date(50);
  assert.deepEqual(await repository.consumeOtpInTransaction(transaction, challenge.id, 'other-target', '000000', { verifyCode: () => false }, new Date(300)), { status: 'invalid' });
  assert.equal(writes, 1);
});

test('known matched challenge terminal states never mutate and success returns expiry for later recheck', async () => {
  let writes = 0;
  const challenge = { id: randomUUID(), targetDigest: 'target', codeMac: 'private', expiresAt: new Date(200), consumedAt: null, failedAttempts: 0, attemptLimit: 5 };
  const transaction = { $queryRaw: async () => [challenge], otpChallenge: { update: async () => { writes++; } } };
  const repository = new AuthRepository({});
  const consume = () => repository.consumeOtpInTransaction(transaction, challenge.id, 'target', '000000', { verifyCode: () => true }, new Date(100));
  challenge.failedAttempts = 5;
  assert.equal((await consume()).status, 'exhausted');
  challenge.expiresAt = new Date(99);
  assert.equal((await consume()).status, 'expired');
  challenge.consumedAt = new Date(50);
  assert.equal((await consume()).status, 'already-consumed');
  assert.equal(writes, 0);
  challenge.failedAttempts = 0; challenge.expiresAt = new Date(200); challenge.consumedAt = null;
  assert.deepEqual(await consume(), { status: 'consumed', expiresAt: new Date(200) });
  assert.equal(writes, 1);
});

test('request cooldown survives consumption and cap only rejects without mutating old challenges', async () => {
  const repository = new AuthRepository({});
  let active = [];
  const transaction = { otpChallenge: { findFirst: async () => ({ createdAt: new Date(1000) }) }, $queryRaw: async () => active };
  const input = { targetDigest: 'a'.repeat(64), cooldownMs: 60_000, maxActiveChallenges: 2 };
  assert.deepEqual(await repository.otpRequestAvailability(transaction, input, new Date(60_000)), { allowed: false, retryAfterSeconds: 1 });
  active = [{ expiresAt: new Date(80_000) }, { expiresAt: new Date(90_000) }];
  assert.deepEqual(await repository.otpRequestAvailability(transaction, input, new Date(61_000)), { allowed: false, retryAfterSeconds: 19 });
  assert.deepEqual(await repository.otpRequestAvailability(transaction, input, new Date(80_000)), { allowed: true });
});

test('rotation locks the common root before reading current state and appends audit in its transaction', async () => {
  const root = randomUUID(); const previous = randomUUID(); const successor = randomUUID(); const userId = randomUUID();
  const correlationId = randomUUID(); const order = []; const expiry = new Date(200);
  let query = 0;
  const transaction = {
    $queryRaw: async strings => {
      order.push(strings.join('?'));
      query++;
      if (query === 1 || query === 2) return [{ id: root }];
      return [{ id: previous, userId, expiresAt: expiry, revokedAt: null, authenticationMethod: 'MOBILE_OTP' }];
    },
    authSession: {
      update: async ({ where, data }) => { order.push('revoke'); assert.equal(where.id, previous); assert.equal(data.revokedAt.getTime(), 100); },
      create: async ({ data }) => { order.push('create'); assert.equal(data.rotatedFromId, previous); assert.equal(data.expiresAt, expiry); assert.equal(data.authenticationMethod, 'MOBILE_OTP'); return { id: successor, userId, expiresAt: expiry }; },
    },
    auditLog: { create: async ({ data }) => { order.push('audit'); assert.equal(data.entityId, previous); assert.equal(data.action, 'auth.session.rotated'); assert.equal(data.correlationId, correlationId); } },
  };
  const repository = new AuthRepository({ client: { $transaction: async fn => fn(transaction) } });
  assert.deepEqual(await repository.rotateMobileSession('old', 'next', new Date(100), correlationId), { id: successor, userId, expiresAt: expiry });
  assert.match(order[0], /WITH RECURSIVE ancestors/);
  assert.match(order[1], /FOR UPDATE/);
  assert.match(order[2], /tokenDigest/);
  assert.deepEqual(order.slice(3), ['revoke', 'create', 'audit']);
});

test('stale ancestor logout locks its root and recursively revokes only its own family with audit', async () => {
  const root = randomUUID(); const userId = randomUUID(); let queries = 0; let audit;
  const transaction = {
    $queryRaw: async (strings, ...values) => {
      queries++;
      if (queries === 1) return [{ id: root }];
      if (queries === 2) { assert.match(strings.join(''), /FOR UPDATE/); assert.equal(values[0], root); return [{ id: root }]; }
      assert.match(strings.join(''), /WITH RECURSIVE family/);
      assert.equal(values[0], root);
      assert.match(strings.join(''), /rotatedFromId/);
      return [{ id: randomUUID(), userId }];
    },
    auditLog: { create: async ({ data }) => { audit = data; } },
  };
  const repository = new AuthRepository({ client: { $transaction: async fn => fn(transaction) } });
  assert.equal(await repository.revokeSession('stale', new Date(100)), true);
  assert.equal(audit.entityId, root);
  assert.equal(audit.action, 'auth.session.revoked');
  assert.deepEqual(audit.afterSummary, { active: false, revokedCount: 1 });
});

test('known expired mobile session is distinguished while revoked and admin sessions remain invalid', async () => {
  let row = { id: 'session', userId: 'user', expiresAt: new Date(200), revokedAt: null };
  const repository = new AuthRepository({ client: { authSession: { findFirst: async ({ where }) => { assert.equal(where.authenticationMethod, 'MOBILE_OTP'); return row; } } } });
  assert.equal((await repository.lookupMobileSession('digest', new Date(300))).status, 'expired');
  row = { ...row, revokedAt: new Date(100) };
  assert.equal((await repository.lookupMobileSession('digest', new Date(300))).status, 'invalid');
  row = null;
  assert.equal((await repository.lookupMobileSession('digest', new Date(100))).status, 'invalid');
});


test('issuance helpers allowlist persistence fields and cannot accept supplied assurance or lineage', async () => {
  let challenge; let session;
  const transaction = {
    otpChallenge: { create: async ({ data }) => { challenge = data; } },
    authSession: { create: async ({ data }) => { session = data; return { id: 'id', userId: data.userId, expiresAt: data.expiresAt }; } },
  };
  const repository = new AuthRepository({});
  await repository.createOtpChallenge(transaction, { id: 'id', targetDigest: 'digest', codeMac: 'mac', createdAt: new Date(100), expiresAt: new Date(200), attemptLimit: 5, rawCode: 'private', consumedAt: new Date(150) });
  assert.deepEqual(Object.keys(challenge).sort(), ['attemptLimit', 'codeMac', 'createdAt', 'expiresAt', 'id', 'targetDigest']);
  await repository.issueMobileSession(transaction, { userId: 'user', tokenDigest: 'digest', expiresAt: new Date(200), authenticationMethod: 'ADMIN_PASSWORD_TOTP', rotatedFromId: 'other-family', rawToken: 'private' }, new Date(100));
  assert.deepEqual(Object.keys(session).sort(), ['authenticationMethod', 'createdAt', 'expiresAt', 'tokenDigest', 'userId']);
  assert.equal(session.authenticationMethod, 'MOBILE_OTP');
});
