import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AuditService } from '../dist/modules/audit/audit.service.js';
import { AuditRepository } from '../dist/modules/audit/audit.repository.js';

const entry = () => ({ actorId: randomUUID(), action: 'auth.user_role.assign', entityType: 'UserRole', entityId: `${randomUUID()}:${randomUUID()}`, beforeSummary: { assigned: false }, afterSummary: { assigned: true } });

test('audit rejects unrestricted snapshots, PII/secrets, unknown keys and unbounded values', () => {
  const service = new AuditService();
  const safe = entry();
  assert.deepEqual(service.sanitize(safe), safe);
  for (const key of ['mobile', 'email', 'birthDate', 'password', 'totpSecret', 'otpCode', 'sessionToken', 'request']) {
    const value = { ...safe, afterSummary: { assigned: true, [key]: 'must-not-leak' } };
    assert.throws(() => service.sanitize(value), error => error.message === 'Invalid audit summary.' && !error.message.includes('must-not-leak'));
    assert.throws(() => service.sanitize({ ...safe, [key]: 'must-not-leak' }), /Invalid audit entry/);
  }
  assert.throws(() => service.sanitize({ ...safe, entityId: 'x'.repeat(2000) }), /Invalid audit entry/);
  assert.throws(() => service.sanitize({ ...safe, action: 'arbitrary.event' }), /Invalid audit entry/);
});

test('append accepts only the caller transaction and has no update/delete API', async () => {
  const repository = new AuditRepository(new AuditService());
  const safe = entry();
  let data;
  await repository.append({ auditLog: { create: async query => { data = query.data; } } }, safe);
  assert.deepEqual(data, safe);
  assert.equal(typeof repository.update, 'undefined');
  assert.equal(typeof repository.delete, 'undefined');
});
