import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { test } from 'node:test';
import { startAuthBrowserHarness } from '../../api/scripts/auth-web-test-harness.mjs';

const origin = 'http://127.0.0.1:3100';
const base = 'http://127.0.0.1:3201/api/v1/auth';
const headers = { origin, 'content-type': 'application/json', 'x-rahrow-auth': '1' };

// This executes the actual Nest/service/Fake graph without a browser or PostgreSQL.
// It is setup/contract evidence only, not the browser or live database acceptance gate.
test('browser fixture owns actual Nest service and Fake delivery with no reveal route', async () => {
  const fixture = await startAuthBrowserHarness({ mode: 'contract', origin, port: 3201 });
  try {
    const mobile = `+999${randomInt(100_000_000, 999_999_999)}`;
    const request = await globalThis.fetch(`${base}/otp/request`, { method: 'POST', headers, body: JSON.stringify({ mobile }) });
    assert.equal(request.status, 202);
    const challenge = await request.json();
    assert.deepEqual(Object.keys(challenge).sort(), ['challengeId', 'expiresAt', 'retryAfterSeconds']);
    const code = fixture.codeFor(challenge.challengeId);
    assert.equal(typeof code === 'string' && /^[0-9]{6}$/.test(code), true);
    assert.equal(JSON.stringify(challenge).includes(code), false);
    for (const path of ['otp/reveal', `otp/${challenge.challengeId}`, 'fake/delivery', 'test/code']) {
      const response = await globalThis.fetch(`${base}/${path}`, { headers });
      assert.equal(response.status, 404);
      assert.equal((await response.text()).includes(code), false);
    }
    const verification = await globalThis.fetch(`${base}/otp/verify`, { method: 'POST', headers,
      body: JSON.stringify({ challengeId: challenge.challengeId, mobile, code }) });
    assert.equal(verification.status, 200);
    const cookie = verification.headers.get('set-cookie');
    assert.equal(typeof cookie === 'string' && cookie.includes('HttpOnly'), true);
    const result = await verification.json();
    assert.equal(result.user.mobile === mobile, true);
    assert.equal(result.user.email, null);
    assert.equal(result.user.firstName, null);
    assert.equal(result.user.lastName, null);
    assert.equal(result.user.birthDate, null);
    assert.equal(result.user.displayName, null);
    assert.equal(result.user.avatar, null);
    assert.equal('token' in result, false);
    const authenticated = { ...headers, cookie: cookie.split(';')[0] };
    assert.equal((await globalThis.fetch(`${base}/session`, { headers: authenticated })).status, 200);
    const rotation = await globalThis.fetch(`${base}/session/rotate`, { method: 'POST', headers: authenticated, body: '{}' });
    assert.equal(rotation.status, 200);
    const nextCookie = rotation.headers.get('set-cookie');
    assert.equal(typeof nextCookie === 'string', true);
    authenticated.cookie = nextCookie.split(';')[0];
    assert.equal((await globalThis.fetch(`${base}/logout`, { method: 'POST', headers: authenticated, body: '{}' })).status, 204);
    assert.equal((await globalThis.fetch(`${base}/session`, { headers: authenticated })).status, 401);
  } finally { await fixture.close(); }
});

test('browser fixture preserves actual Origin safeguards and default cooldown', async () => {
  const fixture = await startAuthBrowserHarness({ mode: 'contract', origin, port: 3201 });
  try {
    const mobile = `+999${randomInt(100_000_000, 999_999_999)}`;
    const body = JSON.stringify({ mobile });
    const forbidden = await globalThis.fetch(`${base}/otp/request`, { method: 'POST', headers: { ...headers, origin: 'https://example.invalid' }, body });
    assert.equal(forbidden.status, 403);
    assert.equal((await globalThis.fetch(`${base}/otp/request`, { method: 'POST', headers, body })).status, 202);
    const limited = await globalThis.fetch(`${base}/otp/request`, { method: 'POST', headers, body });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    fixture.advance(60_001);
    assert.equal((await globalThis.fetch(`${base}/otp/request`, { method: 'POST', headers, body })).status, 202);
  } finally { await fixture.close(); }
});
