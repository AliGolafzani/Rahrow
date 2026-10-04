import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import test from 'node:test';
import { AuthConfig, DEFAULT_AUTH_RATE_LIMITS } from '../dist/modules/auth/auth.config.js';
import { FakeOtpDeliveryProvider } from '../dist/modules/auth/fake-otp-delivery.provider.js';
import { MobileOtpService } from '../dist/modules/auth/mobile-otp.service.js';
import { AuthRateLimiter } from '../dist/modules/auth/auth.rate-limits.js';
import { createSessionToken, generateOtpCode } from '../dist/modules/auth/auth.security.js';

const mobile = '+12025550123';
function config(options = {}) {
  return new AuthConfig({ mode: 'test', host: '127.0.0.1', nodeEnv: 'test', localCookie: true,
    allowedOrigins: ['http://127.0.0.1:3000'], key: randomBytes(32), ...options });
}
function codeIs(error, code) { return error.code === code; }

test('unconfigured defaults preserve secure transport and fail closed without a key', () => {
  const value = new AuthConfig({ mode: 'unconfigured', nodeEnv: 'production' });
  assert.equal(value.cookieName, '__Host-rahrow_session');
  assert.equal(value.cookieSecure, true);
  assert.equal(value.configured, false);
  assert.throws(() => value.mac, error => codeIs(error, 'AUTH_UNAVAILABLE'));
});

test('Fake activation and local cookies reject production or non-loopback configuration', () => {
  for (const options of [
    { nodeEnv: 'production' }, { host: '0.0.0.0' }, { host: '192.168.1.4' },
    { allowedOrigins: ['https://example.com'] }, { allowedOrigins: ['null'] },
    { allowedOrigins: ['http://127.0.0.1:3000/'] }, { allowedOrigins: [] },
  ]) assert.throws(() => config(options), /configuration is unsafe or invalid/);
  assert.throws(() => new AuthConfig({ mode: 'unconfigured', localCookie: true, nodeEnv: 'production' }), /configuration/);
  assert.equal(config({ localCookie: false }).cookieSecure, true);
});

test('compiled production startup refuses explicit Fake activation with sanitized output', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new globalThis.URL('../dist/main.js', import.meta.url))], {
    env: { ...process.env, NODE_ENV: 'production', AUTH_MODE: 'local', HOST: '127.0.0.1',
      AUTH_COOKIE_MODE: 'secure', AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:3000' },
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr + result.stdout, /Authentication configuration is unsafe or invalid|API startup failed/);
  assert.equal((result.stderr + result.stdout).includes('http://127.0.0.1:3000'), false);
});

test('config rejects malformed bounds, mutable budget inputs, and unknown rate dimensions', () => {
  for (const options of [ { otpAttemptLimit: 21 }, { deliveryTimeoutMs: 0 }, { sessionLifetimeMs: NaN },
    { rateLimits: { unknown: [{ limit: 1, windowMs: 1000 }] } },
    { rateLimits: { requestIp: [] } }, { rateLimits: { requestIp: [{ limit: -1, windowMs: 1000 }] } },
  ]) assert.throws(() => config(options), /configuration/);
  const source = [{ limit: 1, windowMs: 1000 }];
  const value = config({ rateLimits: { requestIp: source } });
  source[0].limit = 999;
  assert.equal(value.rateLimits.requestIp[0].limit, 1);
  assert.equal(Object.isFrozen(value.rateLimits.requestIp[0]), true);
  assert.equal(Object.keys(DEFAULT_AUTH_RATE_LIMITS).length, 10);
});

test('shared injected key shares namespaces while ephemeral local keys do not serialize', () => {
  const key = randomBytes(32);
  const left = config({ key });
  const right = config({ key });
  assert.equal(left.mac.targetDigest(mobile), right.mac.targetDigest(mobile));
  assert.notEqual(config({ key: undefined }).mac.targetDigest(mobile), config({ key: undefined }).mac.targetDigest(mobile));
  for (const rendered of [JSON.stringify(left), inspect(left)]) {
    assert.equal(rendered.includes(key.toString('hex')), false);
    assert.equal(rendered.includes(key.toString('base64')), false);
  }
});

test('Fake has bounded private retrieval and redacts code/target from ordinary serialization', async () => {
  const delivery = new FakeOtpDeliveryProvider(1);
  const event = { challengeId: randomUUID(), target: mobile, code: generateOtpCode(),
    expiresAt: new Date(Date.now() + 60000), signal: new globalThis.AbortController().signal };
  await delivery.deliver(event);
  const recorded = delivery.getDelivery(event.challengeId);
  assert.equal(recorded.code === event.code, true, 'Harness retrieves exact delivery without exposing it in failure output.');
  assert.equal(recorded.target === mobile, true);
  for (const rendered of [JSON.stringify(recorded), inspect(recorded), JSON.stringify(delivery), inspect(delivery)]) {
    assert.equal(rendered.includes(event.code), false);
    assert.equal(rendered.includes(mobile), false);
  }
  await assert.rejects(() => delivery.deliver({ ...event, challengeId: randomUUID() }), /unavailable/);
  assert.equal(delivery.size, 1);
});

test('Fake rejects aborted/expired and duplicate delivery, expires private records', async () => {
  let now = new Date();
  const delivery = new FakeOtpDeliveryProvider(2, () => now);
  const event = { challengeId: randomUUID(), target: mobile, code: '001234',
    expiresAt: new Date(now.getTime() + 1000), signal: new globalThis.AbortController().signal };
  const controller = new globalThis.AbortController(); controller.abort();
  await assert.rejects(() => delivery.deliver({ ...event, signal: controller.signal }));
  await delivery.deliver(event);
  await assert.rejects(() => delivery.deliver(event));
  now = new Date(now.getTime() + 1001);
  assert.equal(delivery.getDelivery(event.challengeId), undefined);
  await assert.rejects(() => delivery.deliver(event));
});

test('rate admission derives fixed windows and domain-separated keyed identifiers, never raw PII', async () => {
  const calls = [];
  const now = new Date('2026-10-03T10:01:04.000Z');
  const value = config({ clock: () => now });
  const limiter = new AuthRateLimiter({ async useRateLimit(input) { calls.push(input); return true; } }, value);
  await limiter.admit([['requestIp', '127.0.0.1'], ['requestTarget', value.mac.targetDigest(mobile)]]);
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(call => call.bucketKey)).size, 4);
  for (const call of calls) {
    assert.match(call.bucketKey, /^[a-f0-9]{64}$/);
    assert.equal(call.scope, 'otp-challenge');
    assert.equal(call.windowStart <= now && call.expiresAt > now, true);
    assert.equal(JSON.stringify(call).includes(mobile), false);
    assert.equal(JSON.stringify(call).includes('127.0.0.1'), false);
  }
});

test('rate throttling returns retry and backend failures fail closed', async () => {
  const value = config();
  const limiter = new AuthRateLimiter({ async useRateLimit() { return false; } }, value);
  await assert.rejects(() => limiter.admit([['logoutIp', '127.0.0.1']]), error => codeIs(error, 'AUTH_THROTTLED') && error.retryAfterSeconds > 0);
  const unavailable = new AuthRateLimiter({ async useRateLimit() { throw new Error('private database details'); } }, value);
  await assert.rejects(() => unavailable.admit([['logoutIp', '127.0.0.1']]), error => codeIs(error, 'AUTH_UNAVAILABLE') && !String(error).includes('private'));
});

function requestHarness({ delivery = new FakeOtpDeliveryProvider(), auditFailure = false, transactionFailure = false, options = {} } = {}) {
  const state = { challenges: [], audits: [], admissions: 0, users: 0 };
  const repository = {
    async useRateLimit() { state.admissions++; return true; },
    async withTransaction(operation) {
      const snapshot = { challenges: state.challenges.length, audits: state.audits.length };
      try { const result = await operation({}); if (transactionFailure) throw new Error('private commit detail'); return result; }
      catch (error) { state.challenges.length = snapshot.challenges; state.audits.length = snapshot.audits; throw error; }
    },
    async lockOtpTarget() {}, async otpRequestAvailability() { return { allowed: true }; },
    async createOtpChallenge(_, challenge) { state.challenges.push(challenge); },
  };
  const users = { async findOrCreateMobile() { state.users++; throw new Error('Request must never inspect users.'); } };
  const audit = { async append(_, entry) { if (auditFailure) throw new Error('private audit detail'); state.audits.push(entry); } };
  return { state, delivery, service: new MobileOtpService(repository, users, audit, config(options), delivery) };
}

test('OTP request never inspects User, and API/audit/storage metadata omit delivery secrets', async () => {
  const { service, delivery, state } = requestHarness();
  const result = await service.requestOtp({ mobile }, '127.0.0.1');
  const record = delivery.getDelivery(result.challengeId);
  assert.equal(state.users, 0);
  assert.equal(state.challenges.length, 1);
  assert.equal(state.audits.length, 1);
  assert.equal(state.admissions, 4);
  for (const text of [JSON.stringify(result), JSON.stringify(state)]) {
    assert.equal(text.includes(record.code), false);
    assert.equal(text.includes(mobile), false);
  }
});

test('delivery failure, timeout, audit failure and commit failure roll back request without refunding admission', async () => {
  const cases = [
    { delivery: { async deliver() { throw new Error('secret provider value'); } }, code: 'AUTH_DELIVERY_UNAVAILABLE' },
    { delivery: { async deliver() { await new Promise(() => {}); } }, options: { deliveryTimeoutMs: 5 }, code: 'AUTH_DELIVERY_UNAVAILABLE' },
    { auditFailure: true, code: 'AUTH_UNAVAILABLE' }, { transactionFailure: true, code: 'AUTH_UNAVAILABLE' },
  ];
  for (const fixture of cases) {
    const { service, state } = requestHarness(fixture);
    await assert.rejects(() => service.requestOtp({ mobile }, '127.0.0.1'), error => codeIs(error, fixture.code));
    assert.equal(state.challenges.length, 0);
    assert.equal(state.audits.length, 0);
    assert.equal(state.users, 0);
    assert.equal(state.admissions, 4);
  }
});

test('verification commits a matching wrong attempt before returning its safe HTTP error', async () => {
  let committed = false;
  const repository = {
    async useRateLimit() { return true; },
    async withTransaction(operation) { const result = await operation({}); committed = true; return result; },
    async consumeOtpInTransaction() { return { status: 'invalid', failedAttempts: 1, previousFailedAttempts: 0 }; },
  };
  let auditCount = 0;
  const service = new MobileOtpService(repository, {}, { async append() { auditCount++; } }, config(), new FakeOtpDeliveryProvider());
  await assert.rejects(() => service.verifyOtp({ mobile, challengeId: randomUUID(), code: '000000' }, '127.0.0.1'), error => codeIs(error, 'AUTH_OTP_INVALID'));
  assert.equal(committed, true);
  assert.equal(auditCount, 1);
});

test('logout remains idempotent for absent/invalid bearer, but persistence failure is AUTH_UNAVAILABLE', async () => {
  let calls = 0;
  const service = new MobileOtpService({ async useRateLimit() { return true; }, async revokeSession() { calls++; throw new Error('DB details'); } },
    {}, {}, config(), new FakeOtpDeliveryProvider());
  await service.logout(null, '127.0.0.1');
  await service.logout('invalid', '127.0.0.1');
  assert.equal(calls, 0);
  await assert.rejects(() => service.logout(createSessionToken().token, '127.0.0.1'), error => codeIs(error, 'AUTH_UNAVAILABLE'));
  assert.equal(calls, 1);
});
