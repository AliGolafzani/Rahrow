import assert from 'node:assert/strict';
import { test } from 'node:test';
import process from 'node:process';
import { authWebConfig } from '../src/lib/auth/config.ts';
import { canonicalInternalPath, safeReturnTarget } from '../src/lib/auth/return-target.ts';
import { permittedReturnTarget } from '../src/lib/auth/route-policy.ts';

const unsafe = [undefined, null, true, 1, [], ['/dashboard'], ['/dashboard', '/login'], {}, '', 'dashboard', '/',
  'https://example.invalid/dashboard', 'http://example.invalid', 'javascript:alert(1)', '//example.invalid',
  '\\example.invalid', '/\\example.invalid', '/dashboard\\anything', '/dashboard/', '/Dashboard',
  '/dashboard?view=private', '/dashboard#private', '/dashboard\n', '/dashboard\r', '/dashboard\t',
  '/dash\u0000board', ' /dashboard', '/dashboard ', '/dash board', '/./dashboard', '/x/../dashboard',
  '/dashboard//nested', '/%64ashboard', '%2Fdashboard', '/%2fdashboard', '/%252fdashboard',
  '/%2e%2e/dashboard', '/dashboard%3fnext=https://example.invalid', '/%', '/%GG', '/داشبورد', `/${'a'.repeat(512)}`];

test('return parser accepts bounded canonical route keys without decoding or normalization', () => {
  for (const path of ['/dashboard', '/workspace/plan-42', '/a/0', `/${'a'.repeat(511)}`]) assert.equal(canonicalInternalPath(path), path);
  for (const value of unsafe) assert.equal(canonicalInternalPath(value), null);
});

test('shipped return destination allowlist rejects auth loops, API and arbitrary same-origin routes', async () => {
  for (const value of [...unsafe, '/login', '/auth/complete', '/api/v1/auth/session', '/admin', '/unknown', '/workspace/plan-42']) {
    assert.equal(safeReturnTarget(value), '/dashboard');
    assert.equal(await permittedReturnTarget(value, { authenticated: true }), '/dashboard');
  }
  assert.equal(safeReturnTarget('/dashboard'), '/dashboard');
  assert.equal(await permittedReturnTarget('/dashboard', { authenticated: true }), '/dashboard');
});

test('reusable permission registry preserves a nontrivial permitted original destination server-side', async () => {
  const principal = { authenticated: true };
  let checks = 0;
  const policies = Object.freeze({
    '/dashboard': () => true,
    '/workspace/plan-42': async session => { checks++; assert.equal(session, principal); return true; },
    '/workspace/denied': async () => false,
  });
  assert.equal(await permittedReturnTarget('/workspace/plan-42', principal, policies), '/workspace/plan-42');
  assert.equal(checks, 1);
  assert.equal(await permittedReturnTarget('/workspace/denied', principal, policies), '/dashboard');
  assert.equal(await permittedReturnTarget('/workspace/missing', principal, policies), '/dashboard');
  for (const value of unsafe) assert.equal(await permittedReturnTarget(value, principal, policies), '/dashboard');
  assert.equal(checks, 1);
});

test('inherited route policy entries cannot authorize a destination', async () => {
  let called = false;
  const policies = Object.create({ '/workspace/inherited': () => { called = true; return true; } });
  policies['/dashboard'] = () => true;
  assert.equal(await permittedReturnTarget('/workspace/inherited', { authenticated: true }, policies), '/dashboard');
  assert.equal(called, false);
});

test('fixed server origins accept canonical HTTPS and explicit loopback HTTP only', t => {
  const names = ['RAHROW_API_ORIGIN', 'RAHROW_WEB_ORIGIN', 'NEXT_PUBLIC_RAHROW_API_ORIGIN'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const name of names) { if (original[name] === undefined) delete process.env[name]; else process.env[name] = original[name]; } });
  for (const origin of ['https://api.example.invalid', 'https://api.example.invalid:8443', 'http://127.0.0.1:4100', 'http://localhost:3000', 'http://[::1]:3000']) {
    process.env.RAHROW_API_ORIGIN = origin;
    process.env.RAHROW_WEB_ORIGIN = 'https://web.example.invalid';
    assert.deepEqual(authWebConfig(), { apiOrigin: origin, webOrigin: 'https://web.example.invalid' });
    process.env.RAHROW_API_ORIGIN = 'https://fixed-api.example.invalid';
    process.env.RAHROW_WEB_ORIGIN = origin;
    assert.deepEqual(authWebConfig(), { apiOrigin: 'https://fixed-api.example.invalid', webOrigin: origin });
  }
  process.env.NEXT_PUBLIC_RAHROW_API_ORIGIN = 'https://not-authoritative.invalid';
  for (const invalid of ['', 'https://api.example.invalid/', 'https://api.example.invalid/path',
    'https://api.example.invalid?query=x', 'https://api.example.invalid#fragment', 'https://user:password@example.invalid',
    'http://example.invalid', 'http://127.0.0.2', 'ftp://127.0.0.1', 'https://API.example.invalid',
    'https://api.example.invalid:443', '//api.example.invalid', 'malformed', ' https://api.example.invalid']) {
    process.env.RAHROW_API_ORIGIN = invalid;
    process.env.RAHROW_WEB_ORIGIN = 'http://127.0.0.1:3000';
    assert.throws(() => authWebConfig());
    process.env.RAHROW_API_ORIGIN = 'http://127.0.0.1:4100';
    process.env.RAHROW_WEB_ORIGIN = invalid;
    assert.throws(() => authWebConfig());
  }
  process.env.RAHROW_API_ORIGIN = 'http://127.0.0.1:3000';
  process.env.RAHROW_WEB_ORIGIN = 'http://127.0.0.1:3000';
  assert.throws(() => authWebConfig(), { message: 'Authentication web configuration is unavailable.' });
  delete process.env.RAHROW_API_ORIGIN;
  assert.throws(() => authWebConfig());
});
