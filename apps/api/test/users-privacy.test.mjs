import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toPublicProfile } from '../dist/modules/users/public-profile.js';
import { toAuthenticatedSelf, authenticatedSelfSelect } from '../dist/modules/users/authenticated-self.js';
import { UsersRepository } from '../dist/modules/users/users.repository.js';

test('public projection allowlists only displayName/avatar even with a complete private entity', () => {
  const user = { id: 'private-id', mobile: '+12025550123', email: 'private@example.invalid', birthDate: new Date(), firstName: 'Private', lastName: 'Private', displayName: null, avatar: null, passwordHash: 'private', totpCiphertext: 'private', tokenDigest: 'private', userRoles: ['Super Admin'] };
  assert.deepEqual(toPublicProfile(user), { displayName: null, avatar: null });
  assert.deepEqual(Object.keys(toPublicProfile(user)).sort(), ['avatar', 'displayName']);
});

test('public repository requests only public fields and never spreads an entity', async () => {
  const repository = new UsersRepository({ client: { user: { findUnique: async query => {
    assert.deepEqual(query.select, { displayName: true, avatar: true });
    return { displayName: 'Visible', avatar: null, mobile: 'must-not-leak' };
  } } } });
  assert.deepEqual(await repository.publicProfile('user'), { displayName: 'Visible', avatar: null });
});


test('authenticated self is a private exact allowlist preserving nulls and date-only birth date', () => {
  const profile = { id: 'user', mobile: '+12025550123', email: null, firstName: null, lastName: null, birthDate: new Date('2000-01-02T00:00:00.000Z'), displayName: null, avatar: null, tokenDigest: 'private', roles: ['admin'], status: 'invented' };
  const self = toAuthenticatedSelf(profile);
  assert.deepEqual(Object.keys(self).sort(), ['avatar', 'birthDate', 'displayName', 'email', 'firstName', 'id', 'lastName', 'mobile']);
  assert.equal(self.birthDate, '2000-01-02');
  assert.equal(self.firstName, null);
  assert.equal(toAuthenticatedSelf({ ...profile, birthDate: null }).birthDate, null);
});

test('find-or-create writes only canonical mobile and technical identity fields, safely handling conflicts', async () => {
  const repository = new UsersRepository({});
  let inserted = true; let sql; let values;
  const user = { id: 'user', mobile: '+12025550123', email: null, firstName: null, lastName: null, birthDate: null, displayName: null, avatar: null };
  const transaction = {
    $queryRaw: async (strings, ...parameters) => { sql = strings.join('?'); values = parameters; return inserted ? [{ id: user.id }] : []; },
    user: { findUnique: async query => { assert.deepEqual(query, { where: { mobile: user.mobile }, select: authenticatedSelfSelect }); return user; } },
  };
  assert.deepEqual(await repository.findOrCreateMobile(transaction, user.mobile, () => new Date(100)), { user, created: true });
  assert.match(sql, /ON CONFLICT \("mobile"\) DO NOTHING/);
  assert.match(sql, /"id", "mobile", "createdAt", "updatedAt"/);
  assert.equal(values[1], user.mobile);
  inserted = false;
  assert.deepEqual(await repository.findOrCreateMobile(transaction, user.mobile, () => new Date(100)), { user, created: false });
  await assert.rejects(repository.findOrCreateMobile(transaction, ' +12025550123', () => new Date(100)));
});
