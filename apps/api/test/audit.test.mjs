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


test('AUTH-02 audit allows bounded anonymous OTP events and rejects anonymous success or unknown fields', () => {
  const service = new AuditService();
  const requested = { actorId: null, action: 'auth.otp.requested', entityType: 'OtpChallenge', entityId: randomUUID(), beforeSummary: { exists: false }, afterSummary: { exists: true, attemptLimit: 5 } };
  assert.deepEqual(service.sanitize(requested), requested);
  const failed = { ...requested, action: 'auth.otp.failed', beforeSummary: { failedAttempts: 4 }, afterSummary: { failedAttempts: 5, outcome: 'invalid' } };
  assert.deepEqual(service.sanitize(failed), failed);
  for (const key of ['mobile', 'ip', 'code', 'token', 'targetDigest', 'codeMac', 'provider']) {
    assert.throws(() => service.sanitize({ ...requested, afterSummary: { ...requested.afterSummary, [key]: 'private' } }), /Invalid audit summary/);
  }
  assert.throws(() => service.sanitize({ ...requested, afterSummary: { exists: true, attemptLimit: 21 } }), /Invalid audit summary/);
  assert.throws(() => service.sanitize({ ...failed, afterSummary: { failedAttempts: 1, outcome: 'arbitrary' } }), /Invalid audit summary/);
  assert.throws(() => service.sanitize({ ...requested, action: 'auth.otp.consumed', beforeSummary: { consumed: false }, afterSummary: { consumed: true } }), /Invalid audit entry/);
  assert.throws(() => service.sanitize({ ...requested, action: undefined }), /Invalid audit entry/);
});

test('AUTH-02 success audit uses exact MOBILE_OTP assurance and event-specific summary schemas', () => {
  const service = new AuditService(); const actorId = randomUUID();
  const entries = [
    { actorId, action: 'auth.otp.consumed', entityType: 'OtpChallenge', entityId: randomUUID(), beforeSummary: { consumed: false }, afterSummary: { consumed: true } },
    { actorId, action: 'auth.user.created', entityType: 'User', entityId: actorId, beforeSummary: { exists: false }, afterSummary: { exists: true } },
    { actorId, action: 'auth.session.issued', entityType: 'AuthSession', entityId: randomUUID(), beforeSummary: { active: false }, afterSummary: { active: true, authenticationMethod: 'MOBILE_OTP' } },
    { actorId, action: 'auth.session.rotated', entityType: 'AuthSession', entityId: randomUUID(), beforeSummary: { active: true }, afterSummary: { active: false, authenticationMethod: 'MOBILE_OTP' } },
    { actorId, action: 'auth.session.revoked', entityType: 'AuthSession', entityId: randomUUID(), beforeSummary: { active: true }, afterSummary: { active: false, revokedCount: 1 } },
  ];
  for (const safe of entries) {
    assert.deepEqual(service.sanitize(safe), safe);
    assert.throws(() => service.sanitize({ ...safe, actorId: null }), /Invalid audit entry/);
    assert.throws(() => service.sanitize({ ...safe, entityType: 'Arbitrary' }), /Invalid audit entry/);
  }
  assert.throws(() => service.sanitize({ ...entries[2], afterSummary: { active: true, authenticationMethod: 'ADMIN_PASSWORD_TOTP' } }), /Invalid audit summary/);
});
