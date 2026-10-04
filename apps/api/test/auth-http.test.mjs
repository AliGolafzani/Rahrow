import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthController } from '../dist/modules/auth/auth.controller.js';
import { AuthConfig } from '../dist/modules/auth/auth.config.js';
import { AuthHttpError } from '../dist/modules/auth/auth.errors.js';
import { AuthGuard, TrustedSessionResolver } from '../dist/modules/auth/auth.guard.js';
import { AuthHttpGuard, configureAuthHttp } from '../dist/modules/auth/auth.http.js';
import { MobileOtpService } from '../dist/modules/auth/mobile-otp.service.js';
import { createSessionToken } from '../dist/modules/auth/auth.security.js';
import { CapabilitiesGuard } from '../dist/modules/rbac/capabilities.guard.js';
import { RbacService } from '../dist/modules/rbac/rbac.service.js';
import { RequireCapability } from '../dist/modules/rbac/require-capabilities.decorator.js';
import { sessionCookie, clearSessionCookie } from '../dist/modules/auth/auth.cookies.js';

const origin = 'http://127.0.0.1:3000';
const mobile = '+12025550123';
const code = '000001';
const challengeId = randomUUID();
const token = createSessionToken().token;
const nextToken = createSessionToken().token;
const expiresAt = new Date(Date.now() + 3_600_000);
const user = { id: randomUUID(), mobile, email: null, firstName: null, lastName: null, birthDate: null, displayName: null, avatar: null };
const authHeaders = { origin, 'x-rahrow-auth': '1', 'content-type': 'application/json' };

async function fixture(t, options = {}) {
  const configuration = options.configuration ?? new AuthConfig({ mode: 'test', host: '127.0.0.1', allowedOrigins: [origin], key: randomBytes(32) });
  const calls = [];
  const result = { user: { ...user, role: 'must-not-leak', credential: 'must-not-leak' }, expiresAt, token };
  const service = {
    requestOtp: async (...args) => { calls.push(['request', ...args]); return { challengeId, expiresAt, retryAfterSeconds: 60, code: 'must-not-leak' }; },
    verifyOtp: async (...args) => { calls.push(['verify', ...args]); return result; },
    currentSession: async (...args) => { calls.push(['self', ...args]); if (args[0] !== token) throw new AuthHttpError('AUTH_SESSION_INVALID'); return result; },
    rotateSession: async (...args) => { calls.push(['rotate', ...args]); return { expiresAt, token: nextToken }; },
    logout: async (...args) => { calls.push(['logout', ...args]); },
    ...options.service,
  };
  const resolver = new TrustedSessionResolver({ resolveSession: async value => value === token ? { userId: user.id, sessionId: randomUUID(), authenticationMethod: 'MOBILE_OTP' } : null }, configuration);
  class ProtectedController { read() { return { protected: true }; } write() { return { protected: true }; } }
  Controller('private')(ProtectedController);
  UseGuards(AuthGuard, CapabilitiesGuard)(ProtectedController);
  for (const [method, decorator] of [['read', Get('resource')], ['write', Post('resource')]]) {
    const descriptor = Object.getOwnPropertyDescriptor(ProtectedController.prototype, method);
    decorator(ProtectedController.prototype, method, descriptor);
    RequireCapability('fixture.read')(ProtectedController.prototype, method, descriptor);
  }
  class TestModule {}
  Module({ controllers: [AuthController, ProtectedController], providers: [
    { provide: AuthConfig, useValue: configuration }, { provide: MobileOtpService, useValue: service },
    { provide: TrustedSessionResolver, useValue: resolver }, { provide: RbacService, useValue: { permits: async () => true } },
    AuthHttpGuard, AuthGuard, CapabilitiesGuard,
  ] })(TestModule);
  const logs = [];
  const logger = Object.fromEntries(['log', 'error', 'warn', 'debug', 'verbose', 'fatal'].map(level => [level, (...args) => logs.push(args)]));
  const app = await NestFactory.create(TestModule, { bodyParser: false, logger });
  configureAuthHttp(app, configuration);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();
  const send = (path, init = {}) => globalThis.fetch(`${base}/api/v1/auth/${path}`, init);
  const post = (path, body, headers = authHeaders) => send(path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { app, base, send, post, calls, logs, configuration, resolver };
}

async function assertError(response, status, errorCode) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  assert.equal(body.error.code, errorCode);
  assert.match(body.error.correlationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(response.headers.get('x-correlation-id'), body.error.correlationId);
  return body;
}

test('actual HTTP DTO boundary rejects unknown, noncanonical, oversized and malformed input', async t => {
  const { post, send, calls, logs } = await fixture(t);
  for (const body of [{}, { mobile, extra: true }, { mobile: ` ${mobile}` }, { mobile: '12025550123' },
    { mobile: '+0123' }, { mobile: '+۱۲۳' }, { mobile: '+1234567890123456' }, { mobile: 1202 }, [], null]) {
    await assertError(await post('otp/request', body), 400, 'AUTH_INVALID_INPUT');
  }
  for (const patch of [{ challengeId: 'not-uuid' }, { code: 123456 }, { code: '12345' }, { code: '1234567' }, { code: '۱۲۳۴۵۶' }, { extra: true }]) {
    await assertError(await post('otp/verify', { mobile, challengeId, code, ...patch }), 400, 'AUTH_INVALID_INPUT');
  }
  for (const raw of ['{not-json-secret', JSON.stringify({ mobile, extra: 'secret'.repeat(1000) }), '{"__proto__":{},"mobile":"+12025550123"}']) {
    const response = await send('otp/request', { method: 'POST', headers: authHeaders, body: raw });
    const result = await assertError(response, 400, 'AUTH_INVALID_INPUT');
    assert.doesNotMatch(JSON.stringify(result), /not-json-secret|__proto__|12025550123/);
  }
  assert.equal(calls.length, 0);
  assert.doesNotMatch(JSON.stringify(logs), /not-json-secret|12025550123|۱۲۳/);
});

test('POST Origin, custom-header and JSON protections apply before any business work', async t => {
  const { post, calls } = await fixture(t);
  for (const headers of [
    { ...authHeaders, origin: 'null' }, { ...authHeaders, origin: `${origin}/` }, { ...authHeaders, origin: 'https://evil.invalid' },
    { 'x-rahrow-auth': '1', 'content-type': 'application/json' }, { origin, 'content-type': 'application/json' },
    { ...authHeaders, 'x-rahrow-auth': '2' }, { ...authHeaders, 'content-type': 'text/plain' },
    { ...authHeaders, 'content-type': 'application/x-www-form-urlencoded' }, { ...authHeaders, origin: `${origin}, https://evil.invalid` },
  ]) await assertError(await post('otp/request', { mobile }, headers), 403, 'AUTH_REQUEST_FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('five HTTP endpoints expose only approved projections and committed cookie transport', async t => {
  const { post, send, calls } = await fixture(t);
  const requested = await post('otp/request', { mobile });
  assert.equal(requested.status, 202);
  assert.deepEqual(await requested.json(), { challengeId, expiresAt: expiresAt.toISOString(), retryAfterSeconds: 60 });
  assert.equal(requested.headers.get('set-cookie'), null);
  const verified = await post('otp/verify', { mobile, challengeId, code });
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), { user, session: { expiresAt: expiresAt.toISOString() } });
  const cookie = verified.headers.get('set-cookie');
  assert.ok(cookie.startsWith(`__Host-rahrow_session=${token};`));
  for (const flag of ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', 'Expires=', 'Max-Age=']) assert.ok(cookie.includes(flag));
  assert.doesNotMatch(cookie, /Domain=/i);
  const headers = { 'x-rahrow-auth': '1', cookie: `__Host-rahrow_session=${token}` };
  const self = await send('session', { headers });
  assert.equal(self.status, 200);
  assert.deepEqual(await self.json(), { user, session: { expiresAt: expiresAt.toISOString() } });
  assert.equal(self.headers.get('set-cookie'), null);
  const rotated = await post('session/rotate', {}, { ...authHeaders, ...headers });
  assert.equal(rotated.status, 200);
  assert.deepEqual(await rotated.json(), { session: { expiresAt: expiresAt.toISOString() } });
  assert.ok(rotated.headers.get('set-cookie').startsWith(`__Host-rahrow_session=${nextToken};`));
  const logout = await post('logout', {}, { ...authHeaders, ...headers });
  assert.equal(logout.status, 204);
  assert.equal(await logout.text(), '');
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual(calls.map(call => call[0]), ['request', 'verify', 'self', 'rotate', 'logout']);
  for (const call of calls) { assert.equal(call[2], '127.0.0.1'); assert.match(call[3], /^[0-9a-f-]{36}$/); }
});

test('GET rejects cross-site Fetch Metadata and unapproved supplied origins; no Authorization fallback', async t => {
  const { send } = await fixture(t);
  const headers = { 'x-rahrow-auth': '1', cookie: `__Host-rahrow_session=${token}` };
  for (const extra of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'invalid' }, { origin: 'null' }, { origin: 'https://evil.invalid' }]) {
    await assertError(await send('session', { headers: { ...headers, ...extra } }), 403, 'AUTH_REQUEST_FORBIDDEN');
  }
  await assertError(await send('session', { headers: { cookie: headers.cookie } }), 403, 'AUTH_REQUEST_FORBIDDEN');
  await assertError(await send('session', { headers: { 'x-rahrow-auth': '1', authorization: `Bearer ${token}` } }), 401, 'AUTH_SESSION_INVALID');
  for (const site of ['same-origin', 'same-site', 'none']) assert.equal((await send('session', { headers: { ...headers, 'sec-fetch-site': site } })).status, 200);
});

test('ambiguous cookies and nonempty lifecycle bodies are rejected, spoofed forwarding never changes IP', async t => {
  const { send, post, calls } = await fixture(t);
  for (const cookie of [`__Host-rahrow_session=${token}; __Host-rahrow_session=${nextToken}`, `__Host-rahrow_session; __Host-rahrow_session=${token}`]) {
    await assertError(await send('session', { headers: { ...authHeaders, cookie } }), 400, 'AUTH_INVALID_INPUT');
    await assertError(await post('logout', {}, { ...authHeaders, cookie }), 400, 'AUTH_INVALID_INPUT');
  }
  for (const path of ['session/rotate', 'logout']) await assertError(await post(path, { token }), 400, 'AUTH_INVALID_INPUT');
  await post('otp/request', { mobile }, { ...authHeaders, 'x-forwarded-for': '198.51.100.123', forwarded: 'for=198.51.100.42', 'x-correlation-id': 'spoofed' });
  assert.equal(calls[0][2], '127.0.0.1');
  assert.notEqual(calls[0][3], 'spoofed');
});

test('CORS is explicit, credentialed, bounded and private even on preflight errors', async t => {
  const { send } = await fixture(t);
  const headers = { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-rahrow-auth' };
  const allowed = await send('otp/request', { method: 'OPTIONS', headers });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), origin);
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(allowed.headers.get('access-control-allow-methods'), 'GET, POST');
  assert.equal(allowed.headers.get('access-control-allow-headers'), 'Content-Type, X-Rahrow-Auth');
  assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
  for (const patch of [{ origin: 'https://evil.invalid' }, { 'access-control-request-method': 'DELETE' }, { 'access-control-request-headers': 'authorization' }]) {
    const denied = await send('otp/request', { method: 'OPTIONS', headers: { ...headers, ...patch } });
    await assertError(denied, 403, 'AUTH_REQUEST_FORBIDDEN');
    assert.notEqual(denied.headers.get('access-control-allow-origin'), '*');
  }
});

test('service errors stay bounded, throttling includes Retry-After, failed rotation/logout never clears cookie', async t => {
  const privateFailure = new Error(`provider sql mobile ${mobile} code ${code} token ${token}`);
  const { post, logs } = await fixture(t, { service: {
    requestOtp: async () => { throw new AuthHttpError('AUTH_THROTTLED', 42); },
    verifyOtp: async () => { throw privateFailure; },
    rotateSession: async () => { throw new AuthHttpError('AUTH_SESSION_INVALID'); },
    logout: async () => { throw privateFailure; },
  } });
  const throttled = await post('otp/request', { mobile });
  const body = await assertError(throttled, 429, 'AUTH_THROTTLED');
  assert.equal(throttled.headers.get('retry-after'), '42'); assert.equal(body.error.retryAfterSeconds, 42);
  const failed = await post('otp/verify', { mobile, code, challengeId });
  const failure = await assertError(failed, 503, 'AUTH_UNAVAILABLE');
  assert.equal(failed.headers.get('set-cookie'), null);
  assert.doesNotMatch(JSON.stringify(failure), /provider|sql|12025550123|000001/);
  for (const path of ['session/rotate', 'logout']) {
    const response = await post(path, {}, { ...authHeaders, cookie: `__Host-rahrow_session=${token}` });
    await assertError(response, path === 'logout' ? 503 : 401, path === 'logout' ? 'AUTH_UNAVAILABLE' : 'AUTH_SESSION_INVALID');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.doesNotMatch(JSON.stringify(logs), /provider sql|12025550123|000001/);
});

test('unknown/absent cookie logout clears idempotently and local cookie requires explicit safe config', async t => {
  const configuration = new AuthConfig({ mode: 'test', host: '127.0.0.1', allowedOrigins: [origin], localCookie: true, key: randomBytes(32) });
  const { post, calls } = await fixture(t, { configuration });
  const response = await post('logout', {});
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /^rahrow_local_session=;/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /Secure|Domain=/);
  assert.equal(calls[0][1], null);
  assert.doesNotMatch(sessionCookie(configuration, token, expiresAt), /Secure/);
  assert.match(clearSessionCookie({ cookieName: '__Host-rahrow_session', cookieSecure: true }), /Secure/);
});

test('ordinary guard resolves persisted cookies and ignores client-supplied identity', async t => {
  const { resolver } = await fixture(t);
  const guard = new AuthGuard(resolver);
  const context = request => ({ switchToHttp: () => ({ getRequest: () => request }) });
  await assert.rejects(guard.canActivate(context({ method: 'GET', headers: { 'x-rahrow-auth': '1', authorization: `Bearer ${token}` }, authPrincipal: { userId: user.id } })), { code: 'AUTH_SESSION_INVALID' });
  const request = { method: 'GET', headers: { 'x-rahrow-auth': '1', cookie: `__Host-rahrow_session=${token}` }, authPrincipal: { userId: 'forged' } };
  assert.equal(await guard.canActivate(context(request)), true);
  assert.equal(request.authPrincipal.userId, user.id);
});

test('unconfigured authentication fails closed without database/key and unrelated root keeps 404', async t => {
  const { send, post, base, calls } = await fixture(t, { configuration: new AuthConfig({ mode: 'unconfigured' }) });
  await assertError(await send('session'), 503, 'AUTH_UNAVAILABLE');
  await assertError(await post('otp/request', { mobile }), 503, 'AUTH_UNAVAILABLE');
  const root = await globalThis.fetch(`${base}/`);
  assert.equal(root.status, 404);
  assert.equal((await root.json()).statusCode, 404);
  assert.equal(calls.length, 0);
});

test('mixed-case routes and encoded auth paths retain no-store and secret-free parser errors', async t => {
  const { base, calls, logs } = await fixture(t);
  const mixed = await globalThis.fetch(`${base}/API/V1/AUTH/OTP/REQUEST`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ mobile }) });
  assert.equal(mixed.status, 202);
  assert.equal(mixed.headers.get('cache-control'), 'private, no-store');
  for (const path of ['/API/V1/AUTH/OTP/REQUEST', '/%61pi/v1/auth/otp/request', '/api/v1/%61uth/otp/request', '/%61pi/v1/auth/%']) {
    const response = await globalThis.fetch(`${base}${path}`, { method: 'POST', headers: authHeaders, body: '{private-parser-secret' });
    const body = await assertError(response, 400, 'AUTH_INVALID_INPUT');
    assert.doesNotMatch(JSON.stringify(body), /private-parser-secret/);
  }
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /private-parser-secret/);
});

test('shared ordinary resolver rejects cookie-only form posts and disallowed same-site origins', async t => {
  const { resolver } = await fixture(t);
  const cookie = `__Host-rahrow_session=${token}`;
  for (const request of [
    { method: 'GET', headers: { cookie } },
    { method: 'POST', headers: { cookie, origin, 'content-type': 'application/x-www-form-urlencoded' } },
    { method: 'POST', headers: { ...authHeaders, cookie, 'content-type': 'application/x-www-form-urlencoded' } },
    { method: 'POST', headers: { ...authHeaders, cookie, origin: 'http://localhost:9999', 'sec-fetch-site': 'same-site' } },
    { method: 'GET', headers: { 'x-rahrow-auth': '1', cookie, 'sec-fetch-site': 'cross-site' } },
  ]) await assert.rejects(resolver.resolve(request), { code: 'AUTH_REQUEST_FORBIDDEN' });
  assert.equal((await resolver.resolve({ method: 'POST', headers: { ...authHeaders, cookie } })).userId, user.id);
});

test('absolute-form request targets match the router cache and bounded parser boundary', async t => {
  const { base, calls, logs } = await fixture(t);
  const absolute = body => new Promise((resolve, reject) => {
    const request = httpRequest(base, { method: 'POST', path: `${base}/api/v1/auth/otp/request`, headers: authHeaders }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve(new globalThis.Response(text, { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject);
    request.end(body);
  });
  const success = await absolute(JSON.stringify({ mobile }));
  assert.equal(success.status, 202);
  assert.equal(success.headers.get('cache-control'), 'private, no-store');
  const rejected = await absolute('{absolute-private-secret');
  const result = await assertError(rejected, 400, 'AUTH_INVALID_INPUT');
  assert.doesNotMatch(JSON.stringify(result), /absolute-private-secret/);
  assert.doesNotMatch(JSON.stringify(logs), /absolute-private-secret/);
  assert.equal(calls.length, 1);
});

test('actual ordinary and capability guards reject CSRF without controller-scoped filter', async t => {
  const { base, logs } = await fixture(t);
  const cookie = `__Host-rahrow_session=${token}`;
  const allowed = await globalThis.fetch(`${base}/private/resource`, { headers: { 'x-rahrow-auth': '1', cookie } });
  assert.equal(allowed.status, 200);
  for (const init of [
    { headers: { cookie } },
    { method: 'POST', headers: { cookie, origin, 'content-type': 'application/x-www-form-urlencoded' }, body: 'secret=private-form-secret' },
    { method: 'POST', headers: { ...authHeaders, cookie, origin: 'http://localhost:9999', 'sec-fetch-site': 'same-site' }, body: '{}' },
  ]) {
    const response = await globalThis.fetch(`${base}/private/resource`, init);
    assert.equal(response.status, 403);
    assert.doesNotMatch(await response.text(), /private-form-secret|12025550123/);
  }
  const bearerOnly = await globalThis.fetch(`${base}/private/resource`, { headers: { 'x-rahrow-auth': '1', authorization: `Bearer ${token}` } });
  assert.equal(bearerOnly.status, 401);
  assert.doesNotMatch(JSON.stringify(logs), /private-form-secret|12025550123/);
});
