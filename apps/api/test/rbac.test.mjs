import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../dist/modules/rbac/rbac.service.js';
import { CapabilitiesGuard } from '../dist/modules/rbac/capabilities.guard.js';
import { RequireCapability, REQUIRED_CAPABILITY } from '../dist/modules/rbac/require-capabilities.decorator.js';
import { createSessionToken } from '../dist/modules/auth/auth.security.js';

function context(handler, request) {
  return { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => request }) };
}

test('singular capability requirements reject wildcards, arrays and role-name shortcuts', async () => {
  for (const invalid of ['*', 'Super Admin', 'admin.*', ['user.read', 'user.write'], '', undefined]) assert.throws(() => RequireCapability(invalid));
  const service = new RbacService({ hasCapability: async () => { throw new Error('unexpected lookup'); } });
  for (const invalid of ['*', 'Super Admin', ['user.read'], undefined]) assert.equal(await service.permits(randomUUID(), invalid), false);
  assert.equal(await service.permits('not-a-user', 'user.read'), false);
});

test('guard fails closed for missing requirements and ignores spoofed request identity/roles', async () => {
  const handler = () => {};
  const reflector = new Reflector();
  const guard = new CapabilitiesGuard(reflector, { resolveSession: async () => null }, { permits: async () => true });
  await assert.rejects(guard.canActivate(context(handler, {})), { status: 403 });
  Reflect.defineMetadata(REQUIRED_CAPABILITY, 'fixture.read', handler);
  await assert.rejects(guard.canActivate(context(handler, { user: { id: randomUUID(), roles: ['Super Admin'] } })), { status: 401 });
  await assert.rejects(guard.canActivate(context(handler, { headers: { authorization: `Bearer ${createSessionToken().token}` }, user: { roles: ['Super Admin'] } })), { status: 401 });
});

test('current capability assignment controls access independently of role labels', async () => {
  const id = randomUUID();
  let granted = false;
  const service = new RbacService({ hasCapability: async (userId, capability) => {
    assert.equal(userId, id); assert.equal(capability, 'fixture.read'); return granted;
  } });
  const handler = () => {};
  Reflect.defineMetadata(REQUIRED_CAPABILITY, 'fixture.read', handler);
  const guard = new CapabilitiesGuard(new Reflector(), { resolveSession: async () => ({ userId: id, authenticationMethod: 'MOBILE_OTP' }) }, service);
  const request = { headers: { authorization: `Bearer ${createSessionToken().token}` }, user: { roles: ['Super Admin'] } };
  await assert.rejects(guard.canActivate(context(handler, request)), { status: 403 });
  granted = true;
  assert.equal(await guard.canActivate(context(handler, request)), true);
  granted = false;
  await assert.rejects(guard.canActivate(context(handler, request)), { status: 403 });
});
