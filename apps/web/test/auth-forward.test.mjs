import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { boundedBody, forwardAuth, authFailure } from '../src/lib/auth/forward.ts';
import { authenticated, requested, rotated, failure, correlationId, sessionCookie, clearedCookie } from './auth-fixtures.mjs';

const { Headers, Request, Response, ReadableStream, TextEncoder, URL } = globalThis;
const safeMessage = 'Authentication request could not be completed.';
const methods = { 'otp/request': 'POST', 'otp/verify': 'POST', session: 'GET', 'session/rotate': 'POST', logout: 'POST' };

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
function successReply(req, res) {
  switch (req.url) {
    case '/api/v1/auth/otp/request': reply(res, 202, requested); break;
    case '/api/v1/auth/otp/verify': reply(res, 200, authenticated, { 'Set-Cookie': sessionCookie }); break;
    case '/api/v1/auth/session': reply(res, 200, authenticated); break;
    case '/api/v1/auth/session/rotate': reply(res, 200, rotated, { 'Set-Cookie': sessionCookie }); break;
    case '/api/v1/auth/logout': reply(res, 204, undefined, { 'Set-Cookie': clearedCookie }); break;
    default: reply(res, 404, failure('AUTH_REQUEST_FORBIDDEN'));
  }
}
async function listen(server, t) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

/** Actual loopback HTTP on both sides of the forwarding function. Next routing is covered by browser tests. */
async function fixture(t, responder = successReply) {
  const calls = [];
  let handle = responder;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
    await handle(req, res);
  });
  const apiOrigin = await listen(upstream, t);
  let settings;
  const browserBoundary = createServer(async (req, res) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const part of value) headers.append(name, part);
        else if (value !== undefined) headers.set(name, value);
      }
      const request = new Request(`${settings.webOrigin}${req.url}`, { method: req.method, headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
      const rawOperation = new URL(request.url).pathname.replace(/^\/api\/v1\/auth\//, '');
      let operation = rawOperation;
      try { operation = decodeURIComponent(rawOperation); } catch { /* Keep malformed path for refusal. */ }
      const response = await forwardAuth(request, operation, settings);
      const responseHeaders = {};
      response.headers.forEach((value, name) => { if (name !== 'set-cookie') responseHeaders[name] = value; });
      if (response.headers.getSetCookie().length) responseHeaders['set-cookie'] = response.headers.getSetCookie();
      res.writeHead(response.status, responseHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      reply(res, 500, { boundaryFixtureError: true });
    }
  });
  const webOrigin = await listen(browserBoundary, t);
  settings = { apiOrigin, webOrigin };
  const send = (path, { method = Object.hasOwn(methods, path) ? methods[path] : 'POST', headers = {}, body, rawPath } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(webOrigin, { method, path: rawPath ?? `/api/v1/auth/${path}`,
      headers: { ...(method === 'POST' ? { origin: webOrigin, 'content-type': 'application/json' } : {}),
        'x-rahrow-auth': '1', ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const resultHeaders = new Headers();
        for (let index = 0; index < res.rawHeaders.length; index += 2) resultHeaders.append(res.rawHeaders[index], res.rawHeaders[index + 1]);
        resolve(new Response(['HEAD'].includes(method) || [204, 304].includes(res.statusCode) ? null : Buffer.concat(chunks),
          { status: res.statusCode, headers: resultHeaders }));
      });
    });
    req.on('error', reject);
    req.end(body ?? (method === 'POST' ? '{}' : undefined));
  });
  return { send, calls, webOrigin, apiOrigin, settings, setResponder: value => { handle = value; }, upstream };
}
function assertPrivate(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
async function assertError(response, status, code) {
  assert.equal(response.status, status);
  assertPrivate(response);
  assert.equal(response.headers.has('set-cookie'), false, 'failed calls must not change browser session state');
  const value = await response.json();
  assert.deepEqual(Object.keys(value), ['error']);
  assert.equal(value.error.code, code);
  assert.equal(value.error.message, safeMessage);
  assert.match(value.error.correlationId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('x-correlation-id'), value.error.correlationId);
  return value;
}

// Cookie assertions deliberately emit only booleans, never a cookie value in test evidence.
test('five exact operations preserve AUTH02 status, full DTO, cookie flags and no-store over actual HTTP', async t => {
  const { send, calls } = await fixture(t);
  for (const [operation, status, expected] of [
    ['otp/request', 202, requested], ['otp/verify', 200, authenticated], ['session', 200, authenticated],
    ['session/rotate', 200, rotated], ['logout', 204, undefined],
  ]) {
    const response = await send(operation);
    assert.equal(response.status, status);
    assertPrivate(response);
    if (status === 204) assert.equal(await response.text(), '');
    else assert.deepEqual(await response.json(), expected);
    const cookies = response.headers.getSetCookie();
    if (['otp/verify', 'session/rotate', 'logout'].includes(operation)) {
      assert.equal(cookies.length, 1);
      assert.equal(cookies[0] === (operation === 'logout' ? clearedCookie : sessionCookie), true, 'cookie bytes and flags must be unchanged');
    } else assert.equal(cookies.length, 0);
  }
  assert.deepEqual(calls.map(call => [call.method, call.path]), Object.entries(methods).map(([path, method]) => [method, `/api/v1/auth/${path}`]));
});

test('allowlist rejects other operations and wrong methods before contacting upstream', async t => {
  const { send, calls } = await fixture(t);
  for (const path of ['profile', 'otp/reveal', 'admin', 'session/all', 'logout-all', 'constructor', 'toString', '__proto__', '']) {
    await assertError(await send(path), 404, 'AUTH_REQUEST_FORBIDDEN');
  }
  for (const [path, method] of Object.entries(methods)) {
    for (const wrong of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].filter(value => value !== method)) {
      const response = await send(path, { method: wrong });
      await assertError(response, 405, 'AUTH_REQUEST_FORBIDDEN');
      assert.equal(response.headers.get('allow'), method);
    }
  }
  const head = await send('session', { method: 'HEAD' });
  assert.equal(head.status, 405); assertPrivate(head); assert.equal(head.headers.get('allow'), 'GET');
  assert.equal(calls.length, 0);
});

test('POST preserves strict Origin, custom-header and Fetch Metadata checks', async t => {
  const { send, calls, webOrigin } = await fixture(t);
  for (const headers of [
    { origin: '' }, { origin: 'null' }, { origin: `${webOrigin}/` }, { origin: 'https://evil.invalid' },
    { origin: `${webOrigin}, https://evil.invalid` }, { origin: [webOrigin, webOrigin] },
    { 'x-rahrow-auth': '' }, { 'x-rahrow-auth': '2' }, { 'x-rahrow-auth': '1, 1' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-origin, same-origin' }, { 'sec-fetch-site': 'invalid' },
  ]) await assertError(await send('otp/request', { headers }), 403, 'AUTH_REQUEST_FORBIDDEN');
  const missingOrigin = new Request(`${webOrigin}/api/v1/auth/otp/request`, {
    method: 'POST', headers: { 'x-rahrow-auth': '1', 'content-type': 'application/json' }, body: '{}',
  });
  await assertError(await forwardAuth(missingOrigin, 'otp/request', { apiOrigin: 'http://127.0.0.1:1', webOrigin }), 403, 'AUTH_REQUEST_FORBIDDEN');
  const missingCustom = new Request(`${webOrigin}/api/v1/auth/otp/request`, {
    method: 'POST', headers: { origin: webOrigin, 'content-type': 'application/json' }, body: '{}',
  });
  await assertError(await forwardAuth(missingCustom, 'otp/request', { apiOrigin: 'http://127.0.0.1:1', webOrigin }), 403, 'AUTH_REQUEST_FORBIDDEN');
  assert.equal(calls.length, 0);
  for (const site of ['same-origin', 'same-site', 'none']) {
    const response = await send('otp/request', { headers: { 'sec-fetch-site': site } });
    assert.equal(response.status, 202);
    assert.equal(calls.at(-1).headers['sec-fetch-site'], site);
  }
});

test('GET accepts absent Origin but rejects supplied disallowed origins and missing header', async t => {
  const { send, calls, webOrigin, settings } = await fixture(t);
  for (const headers of [{ origin: 'null' }, { origin: 'https://evil.invalid' }, { origin: `${webOrigin}/` },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'invalid' }, { 'x-rahrow-auth': '' }]) {
    await assertError(await send('session', { headers }), 403, 'AUTH_REQUEST_FORBIDDEN');
  }
  await assertError(await forwardAuth(new Request(`${webOrigin}/api/v1/auth/session`), 'session', settings), 403, 'AUTH_REQUEST_FORBIDDEN');
  assert.equal(calls.length, 0);
  assert.equal((await send('session')).status, 200);
  assert.equal(Object.hasOwn(calls[0].headers, 'origin'), false, 'boundary must not manufacture Origin');
  for (const site of ['same-origin', 'same-site', 'none']) assert.equal((await send('session', { headers: { 'sec-fetch-site': site } })).status, 200);
});

test('raw cookie ambiguity is preserved; caller authorization and routing headers never reach the API', async t => {
  const { send, calls } = await fixture(t, (req, res) => {
    if (req.headers.cookie?.split('__Host-rahrow_session=').length === 3) reply(res, 400, failure('AUTH_INVALID_INPUT'));
    else successReply(req, res);
  });
  const cookie = '__Host-rahrow_session=nonsecret-one; __Host-rahrow_session=nonsecret-two; preference=fixture';
  await assertError(await send('session', { headers: { cookie } }), 400, 'AUTH_INVALID_INPUT');
  assert.equal(calls[0].headers.cookie === cookie, true, 'duplicate session cookie names must not be collapsed');
  const response = await send('session', { headers: { cookie: 'preference=fixture', authorization: 'Bearer nonsecret-fixture',
    host: 'evil.invalid', 'x-forwarded-host': 'evil.invalid', 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.1',
    forwarded: 'for=198.51.100.2;host=evil.invalid', 'x-real-ip': '198.51.100.3', 'x-correlation-id': 'caller-controlled',
    'x-admin': 'true', 'x-arbitrary': 'not-allowed' } });
  assert.equal(response.status, 200);
  for (const name of ['authorization', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'forwarded', 'x-real-ip', 'x-correlation-id', 'x-admin', 'x-arbitrary']) {
    assert.equal(Object.hasOwn(calls[1].headers, name), false);
  }
  assert.equal(calls[1].headers.host === 'evil.invalid', false);
});

test('only canonical exact auth paths without query or encoded variants are forwarded', async t => {
  const { send, calls } = await fixture(t);
  for (const rawPath of ['/api/v1/auth/session?x=1', '/api/v1/auth/session?returnTo=%2Fdashboard',
    '/api/v1/auth/%73ession', '/api/v1/auth/%2573ession', '/api/v1/auth/session/', '/api/v1/auth/session%2frotate',
    '/api/v1/auth/SESSION', '/api/v1/auth//session', '/api/v1/auth/%', '/api/v1/%61uth/session',
    '/API/v1/auth/session', '/api/v1/auth/session%00']) {
    const response = await send('session', { rawPath });
    assert.equal([403, 404, 405].includes(response.status), true);
    assertPrivate(response);
  }
  assert.equal(calls.length, 0);
});

test('JSON content types and transfer encoding safeguards run before forwarding', async t => {
  const { send, calls } = await fixture(t);
  for (const headers of [{ 'content-type': '' }, { 'content-type': 'text/plain' },
    { 'content-type': 'application/x-www-form-urlencoded' }, { 'content-type': 'application/json;charset=iso-8859-1' },
    { 'content-type': 'application/json; charset=utf-8; extra=x' }, { 'content-encoding': 'gzip' }, { 'content-encoding': 'identity' }]) {
    await assertError(await send('otp/request', { headers }), 403, 'AUTH_REQUEST_FORBIDDEN');
  }
  assert.equal(calls.length, 0);
  for (const contentType of ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON; CHARSET=UTF-8']) {
    assert.equal((await send('otp/request', { headers: { 'content-type': contentType } })).status, 202);
    assert.equal(calls.at(-1).headers['content-type'], contentType);
  }
});

test('request limit counts UTF-8 bytes at 4096 and preserves exact accepted input', async t => {
  const { send, calls } = await fixture(t);
  const ascii = `{"value":"${'a'.repeat(4084)}"}`;
  assert.equal(Buffer.byteLength(ascii), 4096);
  assert.equal((await send('otp/request', { body: ascii })).status, 202);
  assert.equal(calls[0].body === ascii, true);
  await assertError(await send('otp/request', { body: `${ascii} ` }), 400, 'AUTH_INVALID_INPUT');
  const unicode = `{"value":"${'é'.repeat(2042)}"}`;
  assert.equal(Buffer.byteLength(unicode), 4096);
  assert.equal((await send('otp/request', { body: unicode })).status, 202);
  assert.equal(calls[1].body === unicode, true);
  await assertError(await send('otp/request', { body: `${unicode}é` }), 400, 'AUTH_INVALID_INPUT');
  await assertError(await send('otp/request', { body: Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]) }), 400, 'AUTH_INVALID_INPUT');
  assert.equal(calls.length, 2);
});

test('bounded stream reader handles chunk splits, cancellation and malformed UTF-8', async () => {
  const bytes = new TextEncoder().encode('aéZ');
  assert.equal(await boundedBody(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 2)); controller.enqueue(bytes.slice(2)); controller.close();
  } }), 4), 'aéZ');
  assert.equal(await boundedBody(null, 4), '');
  let cancelled = false;
  const tooLarge = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedBody(tooLarge, 4), { message: 'Body limit exceeded.' });
  assert.equal(cancelled, true);
  await assert.rejects(boundedBody(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xc3])); controller.close(); } }), 4));
});

test('upstream redirects are refused without following Location or relaying its cookie', async t => {
  const { send, calls, webOrigin, setResponder } = await fixture(t);
  for (const status of [301, 302, 303, 307, 308]) {
    setResponder((_req, res) => reply(res, status, { detail: 'must not escape' }, { Location: `${webOrigin}/api/v1/auth/session`, 'Set-Cookie': sessionCookie }));
    await assertError(await send('session'), 503, 'AUTH_UNAVAILABLE');
  }
  assert.equal(calls.length, 5, 'each redirect must cause only the original upstream request');
});

test('all AUTH02 error statuses are preserved with bounded sanitized envelopes and no cookies', async t => {
  const { send, setResponder } = await fixture(t);
  const codes = { AUTH_INVALID_INPUT: 400, AUTH_REQUEST_FORBIDDEN: 403, AUTH_THROTTLED: 429,
    AUTH_OTP_INVALID: 401, AUTH_OTP_EXPIRED: 401, AUTH_OTP_EXHAUSTED: 401, AUTH_OTP_CONSUMED: 401,
    AUTH_SESSION_INVALID: 401, AUTH_SESSION_EXPIRED: 401, AUTH_DELIVERY_UNAVAILABLE: 503, AUTH_UNAVAILABLE: 503 };
  for (const [code, status] of Object.entries(codes)) {
    setResponder((_req, res) => reply(res, status, failure(code), { 'X-Correlation-Id': 'untrusted-header',
      'Cache-Control': 'public, max-age=10000', 'X-Debug': 'private-upstream-diagnostic' }));
    const response = await send('session');
    const body = await assertError(response, status, code);
    assert.equal(body.error.correlationId, correlationId);
    assert.equal(response.headers.has('x-debug'), false);
    assert.deepEqual(Object.keys(body.error), ['code', 'message', 'correlationId']);
  }
});

test('only bounded Retry-After seconds are relayed; retry values remain part of the validated DTO', async t => {
  const { send, setResponder } = await fixture(t);
  for (const retry of ['0', '1', '42', '86400']) {
    setResponder((_req, res) => reply(res, 429, failure('AUTH_THROTTLED', { retryAfterSeconds: Number(retry) }), { 'Retry-After': retry }));
    const response = await send('otp/request');
    const body = await assertError(response, 429, 'AUTH_THROTTLED');
    assert.equal(body.error.retryAfterSeconds, Number(retry));
    assert.equal(response.headers.get('retry-after'), retry);
  }
  for (const retry of ['-1', '1.5', '86401', '999999', '1, 2', 'private-upstream-diagnostic', 'Tue, 01 Jan 2030 00:00:00 GMT']) {
    setResponder((_req, res) => reply(res, 429, failure('AUTH_THROTTLED'), { 'Retry-After': retry }));
    const response = await send('otp/request');
    await assertError(response, 429, 'AUTH_THROTTLED');
    assert.equal(response.headers.has('retry-after'), false);
  }
  for (const value of [-1, 1.5, 86401, '60']) {
    setResponder((_req, res) => reply(res, 429, failure('AUTH_THROTTLED', { retryAfterSeconds: value })));
    await assertError(await send('otp/request'), 503, 'AUTH_UNAVAILABLE');
  }
});

test('malformed, expanded, mismatched and oversized upstream DTOs fail closed with safe diagnostics', async t => {
  const { send, setResponder } = await fixture(t);
  for (const [status, payload] of [[200, null], [200, []], [200, {}], [200, { ...authenticated, token: 'nonsecret-fixture' }],
    [200, { ...authenticated, user: { ...authenticated.user, role: 'admin' } }], [202, authenticated],
    [200, failure()], [418, failure()], [400, failure('AUTH_SESSION_INVALID')],
    [503, { error: { ...failure().error, message: 'x'.repeat(257) } }],
    [503, { error: { ...failure().error, debug: 'private-upstream-diagnostic' } }], [503, { private: 'x'.repeat(32768) }]]) {
    setResponder((_req, res) => reply(res, status, payload));
    await assertError(await send('session'), 503, 'AUTH_UNAVAILABLE');
  }
  for (const body of ['private-upstream-diagnostic', '{"error":', '<html>private diagnostic</html>']) {
    setResponder((_req, res) => { res.writeHead(503, { 'Content-Type': 'text/html' }); res.end(body); });
    await assertError(await send('session'), 503, 'AUTH_UNAVAILABLE');
  }
});

test('unavailable upstream socket and unconfigured forwarding produce only generic private failures', async t => {
  const { send, upstream } = await fixture(t);
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  await assertError(await send('session'), 503, 'AUTH_UNAVAILABLE');
  const request = new Request('http://127.0.0.1:3000/api/v1/auth/session', { headers: { 'x-rahrow-auth': '1' } });
  await assertError(await forwardAuth(request, 'session', { apiOrigin: 'not-an-origin', webOrigin: 'http://127.0.0.1:3000' }), 503, 'AUTH_UNAVAILABLE');
});

test('unexpected or insecure Set-Cookie never reaches the browser, including on errors', async t => {
  const { send, setResponder } = await fixture(t);
  for (const cookie of [sessionCookie.replace('; HttpOnly', ''), sessionCookie.replace('; Secure', ''),
    sessionCookie.replace('Path=/', 'Path=/private'), sessionCookie.replace('SameSite=Lax', 'SameSite=None'),
    `${sessionCookie}; Domain=example.invalid`, sessionCookie.replace('__Host-rahrow_session', 'arbitrary'),
    [sessionCookie, sessionCookie], sessionCookie.replace('nonsecret-fixture', 'x'.repeat(2048))]) {
    setResponder((_req, res) => reply(res, 200, authenticated, { 'Set-Cookie': cookie }));
    await assertError(await send('otp/verify'), 503, 'AUTH_UNAVAILABLE');
  }
  setResponder((_req, res) => reply(res, 200, authenticated));
  await assertError(await send('otp/verify'), 503, 'AUTH_UNAVAILABLE');
  for (const path of ['otp/request', 'session']) {
    setResponder((_req, res) => reply(res, path === 'session' ? 200 : 202, path === 'session' ? authenticated : requested, { 'Set-Cookie': sessionCookie }));
    await assertError(await send(path), 503, 'AUTH_UNAVAILABLE');
  }
  for (const path of ['otp/verify', 'session/rotate', 'logout']) {
    setResponder((_req, res) => reply(res, 503, failure(), { 'Set-Cookie': clearedCookie }));
    await assertError(await send(path), 503, 'AUTH_UNAVAILABLE');
  }
});

test('explicit local cookie transport is preserved byte-for-byte, including expiry and clear', async t => {
  const { send, setResponder } = await fixture(t);
  for (const [path, status, body, original] of [['otp/verify', 200, authenticated, sessionCookie], ['logout', 204, undefined, clearedCookie]]) {
    const local = original.replace('__Host-rahrow_session', 'rahrow_local_session').replace('; Secure', '');
    setResponder((_req, res) => reply(res, status, body, { 'Set-Cookie': local }));
    const response = await send(path);
    assert.equal(response.status, status);
    assertPrivate(response);
    assert.equal(response.headers.getSetCookie().length, 1);
    assert.equal(response.headers.getSetCookie()[0] === local, true);
  }
});

test('local error helper generates fresh correlation IDs without caching any status', async () => {
  const first = authFailure();
  const second = authFailure();
  const a = await assertError(first, 503, 'AUTH_UNAVAILABLE');
  const b = await assertError(second, 503, 'AUTH_UNAVAILABLE');
  assert.notEqual(a.error.correlationId, b.error.correlationId);
  await assertError(authFailure('AUTH_REQUEST_FORBIDDEN'), 403, 'AUTH_REQUEST_FORBIDDEN');
});

test('valid JSON data still requires an upstream JSON content type, while 204 logout remains bodyless', async t => {
  const { send, setResponder } = await fixture(t);
  for (const contentType of [undefined, 'text/html', 'text/plain', 'application/jsonp']) {
    setResponder((_req, res) => {
      res.writeHead(200, contentType === undefined ? {} : { 'Content-Type': contentType });
      res.end(JSON.stringify(authenticated));
    });
    await assertError(await send('session'), 503, 'AUTH_UNAVAILABLE');
  }
  for (const contentType of ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON']) {
    setResponder((_req, res) => reply(res, 200, authenticated, { 'Content-Type': contentType }));
    const response = await send('session');
    assert.equal(response.status, 200);
    assertPrivate(response);
    assert.deepEqual(await response.json(), authenticated);
  }
  setResponder((_req, res) => { res.writeHead(204, { 'Set-Cookie': clearedCookie }); res.end(); });
  const logout = await send('logout');
  assert.equal(logout.status, 204);
  assertPrivate(logout);
  assert.equal(await logout.text(), '');
});


test('cookie attributes are unique, bounded and consistent with issue versus logout semantics', async t => {
  const { send, setResponder } = await fixture(t);
  for (const cookie of [
    `${sessionCookie}; SameSite=None`, `${sessionCookie}; samesite=Lax`, `${sessionCookie}; Path=/private`,
    `${sessionCookie}; HttpOnly`, `${sessionCookie}; Secure`, `${sessionCookie}; Max-Age=0`,
    `${sessionCookie}; Priority=High`, sessionCookie.replace('HttpOnly', 'HttpOnly=1'),
    sessionCookie.replace('Secure', 'Secure=1'), sessionCookie.replace('; Max-Age=3600', ''),
    sessionCookie.replace('Max-Age=3600', 'Max-Age=-1'), sessionCookie.replace('Max-Age=3600', 'Max-Age=604801'),
    sessionCookie.replace('Max-Age=3600', 'Max-Age=0'), sessionCookie.replace('Expires=Tue, 01 Jan 2030 01:00:00 GMT', 'Expires=invalid'),
    sessionCookie.replace('nonsecret-fixture', ''), sessionCookie.replace('nonsecret-fixture', 'invalid,fixture'), clearedCookie,
  ]) {
    setResponder((_req, res) => reply(res, 200, authenticated, { 'Set-Cookie': cookie }));
    await assertError(await send('otp/verify'), 503, 'AUTH_UNAVAILABLE');
  }
  for (const cookie of [sessionCookie, clearedCookie.replace('Max-Age=0', 'Max-Age=1'),
    clearedCookie.replace('__Host-rahrow_session=;', '__Host-rahrow_session=nonsecret-fixture;')]) {
    setResponder((_req, res) => reply(res, 204, undefined, { 'Set-Cookie': cookie }));
    await assertError(await send('logout'), 503, 'AUTH_UNAVAILABLE');
  }
  for (const maxAge of ['1', '604800']) {
    const cookie = sessionCookie.replace('Max-Age=3600', `Max-Age=${maxAge}`);
    setResponder((_req, res) => reply(res, 200, authenticated, { 'Set-Cookie': cookie }));
    const response = await send('otp/verify');
    assert.equal(response.status, 200);
    assert.equal(response.headers.getSetCookie()[0] === cookie, true, 'accepted cookie must remain byte-for-byte unchanged');
  }
});
