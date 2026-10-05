import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSession, requestOtp, verifyOtp, logout, rotateSession, parseRetryAfter } from '../src/lib/auth/client.ts';
import { isCanonicalMobile, isOtpCode, activeChallenge, remainingSeconds, completeAuthPath, verificationNeedsSessionResolution } from '../src/lib/auth/state.ts';
import { AUTH_ERROR_MESSAGES, authErrorMessage, isGuestFailure } from '../src/lib/auth/errors.ts';
import { AUTH_CODES } from '../src/lib/auth/contracts.ts';
import { authenticated, requested, rotated, failure, mobile, challengeId } from './auth-fixtures.mjs';

const { Response, AbortController } = globalThis;
// This is an inert validation fixture, not an issued or delivered OTP.
const verifyInput = { mobile, challengeId, code: '000001' };
const unavailable = interrupted => ({ ok: false, error: { code: 'AUTH_UNAVAILABLE', status: null, interrupted } });
const invalid = { ok: false, error: { code: 'AUTH_INVALID_INPUT', status: 400, interrupted: false } };
const statusByCode = { AUTH_INVALID_INPUT: 400, AUTH_REQUEST_FORBIDDEN: 403, AUTH_THROTTLED: 429,
  AUTH_OTP_INVALID: 401, AUTH_OTP_EXPIRED: 401, AUTH_OTP_EXHAUSTED: 401, AUTH_OTP_CONSUMED: 401,
  AUTH_SESSION_INVALID: 401, AUTH_SESSION_EXPIRED: 401, AUTH_DELIVERY_UNAVAILABLE: 503, AUTH_UNAVAILABLE: 503 };

function mockedFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return handler(url, options); });
  return calls;
}

test('entry validation matches canonical mobile and exactly six ASCII OTP characters without coercion', () => {
  for (const value of ['+1', '+12025550123', '+123456789012345']) assert.equal(isCanonicalMobile(value), true);
  for (const value of [null, undefined, 12, true, [], [mobile], { toString: () => mobile }, '', '+', '+0', '12025550123', '+0123', '+۱۲۳', '+1234567890123456', '+12 3', '+1-23', ' +123', '+123 ', '+123\n']) {
    assert.equal(isCanonicalMobile(value), false);
  }
  for (const value of ['000001', '000000', '123456']) assert.equal(isOtpCode(value), true);
  for (const value of [null, undefined, 123456, true, ['123456'], { toString: () => '123456' }, '', '12345', '1234567', '۱۲۳۴۵۶', '１２３４５６', '123 56', '12345a', ' 123456', '123456\n']) {
    assert.equal(isOtpCode(value), false);
  }
});

test('active challenge keeps the selected server identity and derives only a presentation retry deadline', () => {
  const now = Date.parse('2030-01-01T00:00:00.000Z');
  const result = activeChallenge(requested, mobile, now);
  assert.equal(result.challengeId, requested.challengeId);
  assert.equal(result.expiresAt, requested.expiresAt);
  assert.equal(result.mobile === mobile, true);
  assert.equal(result.retryAt, now + 60000);
  assert.equal(Object.hasOwn(result, 'code'), false);
  assert.equal(Object.hasOwn(requested, 'retryAt'), false, 'response DTO must not be mutated');
  assert.equal(remainingSeconds(result.retryAt, now), 60);
  assert.equal(remainingSeconds(result.retryAt, now + 1), 60);
  assert.equal(remainingSeconds(result.retryAt, now + 59001), 1);
  assert.equal(remainingSeconds(result.retryAt, now + 60000), 0);
  assert.equal(remainingSeconds(result.retryAt, now + 60001), 0);
  assert.equal(activeChallenge({ ...requested, retryAfterSeconds: 0 }, mobile, now).retryAt, now);
});

test('client completion URL contains only the allowlisted destination and never arbitrary input', () => {
  const expected = '/auth/complete?returnTo=%2Fdashboard';
  for (const value of ['/dashboard', '/admin', '/login', '//evil.invalid', 'https://evil.invalid', '/%2Fdashboard', '/dashboard?code=nonsecret']) {
    assert.equal(completeAuthPath(value), expected);
  }
});

test('verification requires session resolution for uncertain mutations and consumed proof only', () => {
  for (const code of AUTH_CODES) {
    assert.equal(verificationNeedsSessionResolution({ code, interrupted: true }), true);
    assert.equal(verificationNeedsSessionResolution({ code, interrupted: false }), code === 'AUTH_OTP_CONSUMED');
  }
});

test('every stable backend code has bounded Persian copy; only authoritative session 401 establishes guest', () => {
  assert.deepEqual(Object.keys(AUTH_ERROR_MESSAGES).sort(), [...AUTH_CODES].sort());
  for (const code of AUTH_CODES) {
    const copy = authErrorMessage({ code });
    assert.equal(typeof copy, 'string');
    assert.equal(copy.length > 0 && copy.length <= 256, true);
    assert.match(copy, /[\u0600-\u06ff]/);
    assert.equal(isGuestFailure({ code, status: statusByCode[code], interrupted: false }), ['AUTH_SESSION_INVALID', 'AUTH_SESSION_EXPIRED'].includes(code));
  }
  for (const status of [null, 200, 403, 429, 503]) {
    assert.equal(isGuestFailure({ code: 'AUTH_SESSION_INVALID', status, interrupted: false }), false);
    assert.equal(isGuestFailure({ code: 'AUTH_SESSION_EXPIRED', status, interrupted: false }), false);
  }
});

test('Retry-After parsing bounds delta seconds and HTTP-date display hints', () => {
  const now = Date.parse('2030-01-01T00:00:00.000Z');
  for (const [value, expected] of [['0', 0], ['1', 1], ['60', 60], ['00060', 60], ['86400', 86400],
    ['Tue, 01 Jan 2030 00:00:01 GMT', 1], ['Wed, 02 Jan 2030 00:00:00 GMT', 86400]]) {
    assert.equal(parseRetryAfter(value, now), expected);
  }
  assert.equal(parseRetryAfter('Tue, 01 Jan 2030 00:00:01 GMT', now + 1), 1);
  for (const value of [null, '', '-1', '1.5', '86401', '999999', 'not-a-retry', 'Infinity', '1, 2',
    'Mon, 31 Dec 2029 23:59:59 GMT', 'Wed, 02 Jan 2030 00:00:01 GMT']) {
    assert.equal(parseRetryAfter(value, now), undefined);
  }
});

test('client exposes only the five exact operations with same-origin cookie transport and no automatic rotation', async t => {
  const responses = new Map([
    ['/api/v1/auth/session', () => Response.json(authenticated)],
    ['/api/v1/auth/otp/request', () => Response.json(requested, { status: 202 })],
    ['/api/v1/auth/otp/verify', () => Response.json(authenticated)],
    ['/api/v1/auth/logout', () => new Response(null, { status: 204 })],
    ['/api/v1/auth/session/rotate', () => Response.json(rotated)],
  ]);
  const calls = mockedFetch(t, url => responses.get(url)());
  assert.deepEqual(await getSession(), { ok: true, value: authenticated });
  assert.equal(calls.length, 1, 'session bootstrap must not rotate or poll');
  assert.deepEqual(await requestOtp({ mobile }), { ok: true, value: requested });
  assert.deepEqual(await verifyOtp(verifyInput), { ok: true, value: authenticated });
  assert.deepEqual(await logout(), { ok: true, value: undefined });
  assert.deepEqual(await rotateSession(), { ok: true, value: rotated });
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['/api/v1/auth/session', 'GET'], ['/api/v1/auth/otp/request', 'POST'], ['/api/v1/auth/otp/verify', 'POST'],
    ['/api/v1/auth/logout', 'POST'], ['/api/v1/auth/session/rotate', 'POST'],
  ]);
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.mode, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-Rahrow-Auth'], '1');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
    assert.equal(Object.hasOwn(options.headers, 'Cookie'), false);
    assert.equal(options.signal.aborted, false);
    if (options.method === 'POST') assert.equal(options.headers['Content-Type'], 'application/json');
    else { assert.equal(Object.hasOwn(options, 'body'), false); assert.equal(Object.hasOwn(options.headers, 'Content-Type'), false); }
  }
  assert.equal(calls[1].options.body === JSON.stringify({ mobile }), true);
  assert.equal(calls[2].options.body === JSON.stringify(verifyInput), true, 'entered code including leading zeros must be sent unchanged');
  assert.equal(calls[3].options.body, '{}');
  assert.equal(calls[4].options.body, '{}');
});

test('invalid entry input fails locally without transmitting a request', async t => {
  const calls = mockedFetch(t, () => { throw new Error('fetch should not run'); });
  for (const value of ['', '12025550123', '+0123', '+۱۲۳', '+1234567890123456', ` ${mobile}`]) {
    assert.deepEqual(await requestOtp({ mobile: value }), invalid);
    assert.deepEqual(await verifyOtp({ ...verifyInput, mobile: value }), invalid);
  }
  for (const code of [123456, null, ['123456'], '', '12345', '1234567', '۱۲۳۴۵۶', ' 123456']) assert.deepEqual(await verifyOtp({ ...verifyInput, code }), invalid);
  for (const challengeId of ['', 'not-uuid', '00000000-0000-0000-0000-000000000000']) {
    assert.deepEqual(await verifyOtp({ ...verifyInput, challengeId }), invalid);
  }
  assert.equal(calls.length, 0);
});

test('all recognized backend errors retain only stable code, status and validated retry metadata', async t => {
  let current;
  const calls = mockedFetch(t, () => Response.json(failure(current), { status: statusByCode[current] }));
  for (const code of AUTH_CODES) {
    current = code;
    const result = await verifyOtp(verifyInput);
    assert.deepEqual(result, { ok: false, error: { code, status: statusByCode[code], interrupted: code === 'AUTH_UNAVAILABLE' } });
    assert.equal(Object.hasOwn(result.error, 'message'), false);
    assert.equal(Object.hasOwn(result.error, 'correlationId'), false);
  }
  assert.equal(calls.length, AUTH_CODES.length, 'known failures must not trigger automatic retry');
});

test('valid unavailable envelopes retain read uncertainty and mark every POST as possibly committed', async t => {
  const calls = mockedFetch(t, () => Response.json(failure(), { status: 503 }));
  assert.deepEqual(await getSession(), { ok: false, error: { code: 'AUTH_UNAVAILABLE', status: 503, interrupted: false } });
  for (const mutate of [() => requestOtp({ mobile }), () => verifyOtp(verifyInput), logout, rotateSession]) {
    assert.deepEqual(await mutate(), { ok: false, error: { code: 'AUTH_UNAVAILABLE', status: 503, interrupted: true } });
  }
  assert.equal(calls.length, 5, 'a valid unavailable envelope must not trigger a replay');
});

test('envelope retry metadata wins over headers, with bounded Retry-After fallback only', async t => {
  let dto = failure('AUTH_THROTTLED', { retryAfterSeconds: 60 });
  let retry = '120';
  mockedFetch(t, () => Response.json(dto, { status: 429, headers: { 'Retry-After': retry } }));
  assert.equal((await requestOtp({ mobile })).error.retryAfterSeconds, 60);
  dto = failure('AUTH_THROTTLED', { retryAfterSeconds: 0 });
  assert.equal((await requestOtp({ mobile })).error.retryAfterSeconds, 0);
  dto = failure('AUTH_THROTTLED');
  assert.equal((await requestOtp({ mobile })).error.retryAfterSeconds, 120);
  retry = '999999';
  assert.equal(Object.hasOwn((await requestOtp({ mobile })).error, 'retryAfterSeconds'), false);
  dto = failure('AUTH_THROTTLED', { retryAfterSeconds: -1 });
  assert.deepEqual(await requestOtp({ mobile }), unavailable(true));
});

test('malformed success, inconsistent error statuses, unknown errors and HTML cannot become authenticated', async t => {
  let response;
  mockedFetch(t, () => response());
  for (const make of [
    () => Response.json(authenticated, { status: 202 }),
    () => Response.json({ ...authenticated, token: 'nonsecret-fixture' }),
    () => Response.json({ user: authenticated.user }),
    () => Response.json({ ...authenticated, user: { ...authenticated.user, role: 'admin' } }),
    () => Response.json(failure('AUTH_SESSION_INVALID'), { status: 403 }),
    () => Response.json(failure('UNKNOWN'), { status: 503 }),
    () => Response.json(failure(), { status: 200 }),
    () => new Response('{invalid-json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    () => new Response(JSON.stringify(authenticated), { status: 200, headers: { 'Content-Type': 'text/html' } }),
    () => new Response(null, { status: 302, headers: { Location: 'https://evil.invalid' } }),
    () => new Response(null, { status: 204 }),
  ]) {
    response = make;
    assert.deepEqual(await getSession(), unavailable(false));
    assert.deepEqual(await verifyOtp(verifyInput), unavailable(true));
  }
});

test('network failures and interrupted mutation never fabricate logout success, guest state or an automatic retry', async t => {
  const calls = mockedFetch(t, () => { throw new Error('Synthetic network failure with diagnostics'); });
  assert.deepEqual(await getSession(), unavailable(false));
  assert.deepEqual(await requestOtp({ mobile }), unavailable(true));
  assert.deepEqual(await verifyOtp(verifyInput), unavailable(true));
  assert.deepEqual(await logout(), unavailable(true));
  assert.deepEqual(await rotateSession(), unavailable(true));
  assert.equal(calls.length, 5);
});

test('only confirmed logout 204 succeeds; backend unavailability does not clear session state', async t => {
  let status = 503;
  mockedFetch(t, () => status === 204 ? new Response(null, { status }) : Response.json(failure(), { status }));
  assert.deepEqual(await logout(), { ok: false, error: { code: 'AUTH_UNAVAILABLE', status: 503, interrupted: true } });
  status = 200;
  assert.deepEqual(await logout(), unavailable(true));
  status = 204;
  assert.deepEqual(await logout(), { ok: true, value: undefined });
});

test('caller cancellation is propagated and classified without a second mutation', async t => {
  const calls = mockedFetch(t, (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error('cancelled'));
    else signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  const controller = new AbortController();
  const pending = verifyOtp(verifyInput, controller.signal);
  controller.abort();
  assert.deepEqual(await pending, unavailable(true));
  const already = new AbortController(); already.abort();
  assert.deepEqual(await getSession(already.signal), unavailable(false));
  assert.equal(calls.length, 2);
  assert.equal(calls.every(({ options }) => options.signal.aborted), true);
});

test('each request has a bounded timeout and clears it on completion', async t => {
  let callback;
  let delay;
  let cleared;
  const handle = {};
  t.mock.method(globalThis, 'setTimeout', (run, milliseconds) => { callback = run; delay = milliseconds; return handle; });
  t.mock.method(globalThis, 'clearTimeout', value => { cleared = value; });
  const calls = mockedFetch(t, (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
  }));
  const pending = verifyOtp(verifyInput);
  assert.equal(delay, 12000);
  callback();
  assert.deepEqual(await pending, unavailable(true));
  assert.equal(cleared, handle);
  assert.equal(calls.length, 1);
});
