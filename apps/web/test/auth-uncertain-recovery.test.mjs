import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSession, verifyOtp, rotateSession } from '../src/lib/auth/client.ts';
import { isAuthError } from '../src/lib/auth/contracts.ts';
import { isGuestFailure } from '../src/lib/auth/errors.ts';
import { forwardAuth } from '../src/lib/auth/forward.ts';
import { verificationNeedsSessionResolution } from '../src/lib/auth/state.ts';
import { authenticated, failure, mobile, challengeId, sessionCookie } from './auth-fixtures.mjs';

const { Headers, Request, Response } = globalThis;
const settings = { webOrigin: 'https://web.example.invalid', apiOrigin: 'https://api.example.invalid' };
// Inert validation input only; this suite does not issue or deliver a real OTP.
const verifyInput = { mobile, challengeId, code: '000001' };

/** Only transport is mocked: real client requests cross the real forwarding boundary. */
function proxyFixture(t, upstreamResponse) {
  const browserCalls = [];
  const upstreamCalls = [];
  const proxyResponses = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith('/api/v1/auth/')) {
      browserCalls.push({ url, method: options.method });
      const headers = new Headers(options.headers);
      // These are browser-supplied same-origin headers, not additions by forwardAuth.
      headers.set('sec-fetch-site', 'same-origin');
      if (options.method === 'POST') headers.set('origin', settings.webOrigin);
      const request = new Request(`${settings.webOrigin}${url}`, { ...options, headers });
      const operation = url.slice('/api/v1/auth/'.length);
      const response = await forwardAuth(request, operation, settings);
      proxyResponses.push(response.clone());
      return response;
    }
    upstreamCalls.push({ url, method: options.method });
    return upstreamResponse(url, options);
  });
  return { browserCalls, upstreamCalls, proxyResponses };
}

async function assertProxyUnavailable(response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.has('set-cookie'), false);
  const body = await response.json();
  assert.equal(isAuthError(body), true, 'the client must receive a valid error envelope, not a transport exception');
  assert.equal(body.error.code, 'AUTH_UNAVAILABLE');
}

const upstreamFailures = [
  ['lost upstream response', () => { throw new Error('Synthetic upstream response lost after request dispatch'); }],
  ['malformed upstream response', () => new Response('{invalid-json', {
    status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie },
  })],
];

for (const [operation, mutate] of [['otp/verify', () => verifyOtp(verifyInput)], ['session/rotate', rotateSession]]) {
  for (const [scenario, failUpstream] of upstreamFailures) {
    test(`${operation}: ${scenario} stays uncertain through the real proxy and resolves by read without replay`, async t => {
      const { browserCalls, upstreamCalls, proxyResponses } = proxyFixture(t, (url, options) => {
        if (options.method === 'GET' && url === `${settings.apiOrigin}/api/v1/auth/session`) {
          return Response.json(authenticated);
        }
        return failUpstream();
      });

      const result = await mutate();
      await assertProxyUnavailable(proxyResponses[0]);
      assert.deepEqual(result, { ok: false, error: { code: 'AUTH_UNAVAILABLE', status: 503, interrupted: true } });
      assert.equal(isGuestFailure(result.error), false);
      if (operation === 'otp/verify') assert.equal(verificationNeedsSessionResolution(result.error), true);
      else assert.equal(result.error.interrupted, true, 'rotation must enter the provider session-resolution branch');
      assert.deepEqual(browserCalls, [{ url: `/api/v1/auth/${operation}`, method: 'POST' }]);
      assert.deepEqual(upstreamCalls, [{ url: `${settings.apiOrigin}/api/v1/auth/${operation}`, method: 'POST' }]);

      // Exercise the required authoritative read explicitly, without replaying the mutation.
      assert.deepEqual(await getSession(), { ok: true, value: authenticated });
      assert.deepEqual(browserCalls, [
        { url: `/api/v1/auth/${operation}`, method: 'POST' },
        { url: '/api/v1/auth/session', method: 'GET' },
      ]);
      assert.deepEqual(upstreamCalls, [
        { url: `${settings.apiOrigin}/api/v1/auth/${operation}`, method: 'POST' },
        { url: `${settings.apiOrigin}/api/v1/auth/session`, method: 'GET' },
      ]);
    });
  }
}

test('authoritative OTP_INVALID crosses the real proxy without forcing session resolution or replay', async t => {
  const { browserCalls, upstreamCalls, proxyResponses } = proxyFixture(t,
    () => Response.json(failure('AUTH_OTP_INVALID'), { status: 401 }));
  const result = await verifyOtp(verifyInput);
  assert.equal(proxyResponses[0].status, 401);
  assert.deepEqual(result, { ok: false, error: { code: 'AUTH_OTP_INVALID', status: 401, interrupted: false } });
  assert.equal(verificationNeedsSessionResolution(result.error), false);
  assert.equal(isGuestFailure(result.error), false);
  assert.deepEqual(browserCalls, [{ url: '/api/v1/auth/otp/verify', method: 'POST' }]);
  assert.deepEqual(upstreamCalls, [{ url: `${settings.apiOrigin}/api/v1/auth/otp/verify`, method: 'POST' }]);
});

test('authoritative OTP_CONSUMED still requires session resolution without replaying consumed proof', async t => {
  const { browserCalls, upstreamCalls } = proxyFixture(t, (_url, options) => options.method === 'GET'
    ? Response.json(authenticated) : Response.json(failure('AUTH_OTP_CONSUMED'), { status: 401 }));
  const result = await verifyOtp(verifyInput);
  assert.deepEqual(result, { ok: false, error: { code: 'AUTH_OTP_CONSUMED', status: 401, interrupted: false } });
  assert.equal(verificationNeedsSessionResolution(result.error), true);
  assert.equal(isGuestFailure(result.error), false);
  assert.equal(browserCalls.length, 1, 'the client must not replay consumed proof');
  assert.deepEqual(await getSession(), { ok: true, value: authenticated });
  assert.deepEqual(browserCalls, [
    { url: '/api/v1/auth/otp/verify', method: 'POST' },
    { url: '/api/v1/auth/session', method: 'GET' },
  ]);
  assert.deepEqual(upstreamCalls.map(({ method }) => method), ['POST', 'GET']);
});

test('a failed authoritative session reread remains unavailable rather than establishing guest', async t => {
  const { browserCalls, upstreamCalls, proxyResponses } = proxyFixture(t, () => {
    throw new Error('Synthetic upstream unavailable');
  });
  const verification = await verifyOtp(verifyInput);
  assert.equal(verification.ok, false);
  assert.equal(verificationNeedsSessionResolution(verification.error), true);
  const session = await getSession();
  await assertProxyUnavailable(proxyResponses[1]);
  assert.deepEqual(session, { ok: false, error: { code: 'AUTH_UNAVAILABLE', status: 503, interrupted: false } });
  assert.equal(isGuestFailure(session.error), false);
  assert.deepEqual(browserCalls.map(({ method }) => method), ['POST', 'GET']);
  assert.deepEqual(upstreamCalls.map(({ method }) => method), ['POST', 'GET']);
});
