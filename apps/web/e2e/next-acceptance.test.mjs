import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startAuthBrowserHarness } from '../../api/scripts/auth-web-test-harness.mjs';

const require = createRequire(import.meta.url);

async function freePort() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Actual built Next + actual Nest/service/Fake; contract store only. Never called live DB acceptance. */
test('built Next dispatch, SSR guards, redirects, cookies and no-store with actual Nest contract fixture', { timeout: 30_000 }, async () => {
  const webPort = await freePort();
  const apiPort = await freePort();
  const origin = `http://127.0.0.1:${webPort}`;
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const fixture = await startAuthBrowserHarness({ mode: 'contract', origin, port: apiPort });
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], {
    cwd: fileURLToPath(new globalThis.URL('../', import.meta.url)),
    env: { ...process.env, RAHROW_WEB_ORIGIN: origin, RAHROW_API_ORIGIN: apiOrigin }, stdio: 'ignore',
  });
  let failed = false;
  server.on('error', () => { failed = true; });
  const send = async (path, init = {}) => {
    const response = await globalThis.fetch(`${origin}${path}`, { redirect: 'manual', ...init });
    if (path.startsWith('/api/v1/auth/')) assert.equal(response.headers.get('cache-control')?.includes('no-store'), true);
    return response;
  };
  const jsonHeaders = { origin, 'x-rahrow-auth': '1', 'content-type': 'application/json' };
  const post = (path, body, headers = jsonHeaders) => send(`/api/v1/auth/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const deadline = Date.now() + 10_000;
    while (true) {
      if (failed || server.exitCode !== null) throw new Error('Built Next test server could not start.');
      try { if ((await send('/login')).status === 200) break; } catch { /* Local startup only. */ }
      if (Date.now() > deadline) throw new Error('Built Next test server readiness timed out.');
      await delay(100);
    }
    const guest = await send('/dashboard');
    assert.equal(guest.status, 307);
    assert.equal(guest.headers.get('location'), '/login?returnTo=%2Fdashboard');
    assert.equal(guest.headers.get('cache-control').includes('no-store'), true);
    const untrusted = await post('otp/request', { mobile: '+999123456789' }, { ...jsonHeaders, origin: 'https://example.invalid' });
    assert.equal(untrusted.status, 403);
    for (const omitted of ['origin', 'x-rahrow-auth']) {
      const invalidHeaders = { ...jsonHeaders };
      delete invalidHeaders[omitted];
      assert.equal((await post('otp/request', { mobile: '+999123456789' }, invalidHeaders)).status, 403);
    }
    assert.equal((await send('/api/v1/auth/session')).status, 403);
    const mobile = `+999${randomInt(100_000_000, 999_999_999)}`;
    const request = await post('otp/request', { mobile });
    assert.equal(request.status, 202);
    const challenge = await request.json();
    const code = fixture.codeFor(challenge.challengeId);
    const verify = await post('otp/verify', { mobile, challengeId: challenge.challengeId, code });
    assert.equal(verify.status, 200);
    assert.equal(verify.headers.get('cache-control').includes('no-store'), true);
    const cookie = verify.headers.get('set-cookie');
    assert.equal(typeof cookie === 'string' && cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax'), true);
    const cookieHeader = cookie.split(';')[0];
    const privateHeaders = { ...jsonHeaders, cookie: cookieHeader };
    const self = await send('/api/v1/auth/session', { headers: privateHeaders });
    assert.equal(self.status, 200);
    const identity = await self.json();
    assert.equal(identity.user.mobile === mobile, true);
    assert.equal('token' in identity, false);
    const dashboard = await send('/dashboard', { headers: { cookie: cookieHeader } });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.headers.get('cache-control').includes('no-store'), true);
    assert.equal(dashboard.headers.get('x-robots-tag'), 'noindex, nofollow');
    const html = await dashboard.text();
    assert.equal(html.includes(mobile), false);
    assert.equal(html.includes(cookieHeader), false);
    assert.equal(html.includes(cookieHeader.slice(cookieHeader.indexOf('=') + 1)), false);
    const duplicateHeaders = { ...privateHeaders, cookie: `${cookieHeader}; ${cookieHeader}` };
    assert.equal((await send('/api/v1/auth/session', { headers: duplicateHeaders })).status, 400);
    const ambiguous = await send('/dashboard', { headers: duplicateHeaders });
    assert.equal(ambiguous.status, 200);
    const ambiguousHtml = await ambiguous.text();
    assert.equal(ambiguousHtml.includes('وضعیت ورود روشن نیست'), true);
    assert.equal(ambiguousHtml.includes('داشبورد راهرو در حال آماده‌سازی است.'), false);
    for (const path of ['/login', '/dashboard']) {
      fixture.failNext('currentSession');
      const unavailable = await send(path, { headers: { cookie: cookieHeader } });
      assert.equal(unavailable.status, 200);
      assert.equal(unavailable.headers.get('location'), null);
      const unavailableHtml = await unavailable.text();
      assert.equal(unavailableHtml.includes('وضعیت ورود روشن نیست'), true);
      assert.equal(unavailableHtml.includes('داشبورد راهرو در حال آماده‌سازی است.'), false);
      assert.equal(unavailableHtml.includes(cookieHeader.slice(cookieHeader.indexOf('=') + 1)), false);
    }
    for (const path of ['/login?returnTo=%2Fdashboard', '/login?returnTo=%2F%2Fexample.invalid',
      '/auth/complete?returnTo=%2Fadmin', '/auth/complete?returnTo=https%3A%2F%2Fexample.invalid',
      '/auth/complete?returnTo=%2F%2Fexample.invalid', '/auth/complete?returnTo=%252F%252Fexample.invalid',
      '/auth/complete?returnTo=%2Fdashboard&returnTo=%2Fadmin']) {
      const response = await send(path, { headers: { cookie: cookieHeader } });
      assert.equal(response.status, path.startsWith('/auth/complete') ? 303 : 307);
      const target = new globalThis.URL(response.headers.get('location'), origin);
      assert.equal(target.origin, origin);
      assert.equal(target.pathname, '/dashboard');
      assert.equal(response.headers.get('cache-control').includes('no-store'), true);
    }
    const rotation = await post('session/rotate', {}, privateHeaders);
    assert.equal(rotation.status, 200);
    const nextCookie = rotation.headers.get('set-cookie');
    assert.equal(typeof nextCookie === 'string', true);
    const rotatedHeaders = { ...privateHeaders, cookie: nextCookie.split(';')[0] };
    const signout = await post('logout', {}, rotatedHeaders);
    assert.equal(signout.status, 204);
    assert.equal(signout.headers.get('set-cookie').includes('Max-Age=0'), true);
    assert.equal((await send('/dashboard', { headers: { cookie: rotatedHeaders.cookie } })).status, 307);
  } finally {
    if (server.exitCode === null) {
      const stopped = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await stopped;
    }
    await fixture.close();
  }
});
