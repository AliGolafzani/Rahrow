import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toPublicProfile } from '../dist/modules/users/public-profile.js';
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
