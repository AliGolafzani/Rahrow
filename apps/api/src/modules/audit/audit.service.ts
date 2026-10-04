import { Injectable } from '@nestjs/common';

export interface AuditSummary { assigned: boolean }
interface AuditIdentity {
  entityId: string;
  correlationId?: string;
}
interface AuthenticatedAuditIdentity extends AuditIdentity { actorId: string }
interface OtpAuditIdentity extends AuditIdentity { actorId: string | null; entityType: 'OtpChallenge' }

/** A closed event vocabulary. No arbitrary snapshots, request data, or security verifiers. */
export type AuditEntry =
  | (AuthenticatedAuditIdentity & {
    action: 'auth.user_role.assign' | 'auth.user_role.remove'; entityType: 'UserRole';
    beforeSummary: AuditSummary; afterSummary: AuditSummary;
  })
  | (OtpAuditIdentity & {
    action: 'auth.otp.requested'; beforeSummary: { exists: false }; afterSummary: { exists: true; attemptLimit: number };
  })
  | (OtpAuditIdentity & {
    action: 'auth.otp.failed'; beforeSummary: { failedAttempts: number };
    afterSummary: { failedAttempts: number; outcome: 'invalid' | 'expired' | 'exhausted' | 'consumed' };
  })
  | (AuthenticatedAuditIdentity & {
    action: 'auth.otp.consumed'; entityType: 'OtpChallenge';
    beforeSummary: { consumed: false }; afterSummary: { consumed: true };
  })
  | (AuthenticatedAuditIdentity & {
    action: 'auth.user.created'; entityType: 'User'; beforeSummary: { exists: false }; afterSummary: { exists: true };
  })
  | (AuthenticatedAuditIdentity & {
    action: 'auth.session.issued'; entityType: 'AuthSession';
    beforeSummary: { active: false }; afterSummary: { active: true; authenticationMethod: 'MOBILE_OTP' };
  })
  | (AuthenticatedAuditIdentity & {
    action: 'auth.session.rotated'; entityType: 'AuthSession';
    beforeSummary: { active: true }; afterSummary: { active: false; authenticationMethod: 'MOBILE_OTP' };
  })
  | (AuthenticatedAuditIdentity & {
    action: 'auth.session.revoked'; entityType: 'AuthSession';
    beforeSummary: { active: true }; afterSummary: { active: false; revokedCount: number };
  });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entryKeys = ['actorId', 'action', 'entityType', 'entityId', 'beforeSummary', 'afterSummary', 'correlationId'];

function exact(value: unknown, fields: Record<string, (field: unknown) => boolean>): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== Object.keys(fields).length ||
      Object.entries(fields).some(([key, validate]) => !Object.hasOwn(value, key) || !validate((value as Record<string, unknown>)[key]))) {
    throw new Error('Invalid audit summary.');
  }
  return Object.fromEntries(Object.keys(fields).map(key => [key, (value as Record<string, unknown>)[key]]));
}
const is = (expected: unknown) => (value: unknown) => value === expected;
const count = (maximum: number, minimum = 0) => (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

@Injectable()
export class AuditService {
  sanitize(entry: AuditEntry): AuditEntry {
    if (!entry || typeof entry !== 'object' || typeof entry.action !== 'string' || Object.keys(entry).some(key => !entryKeys.includes(key)) ||
        (entry.correlationId !== undefined && !uuid.test(entry.correlationId)) ||
        (entry.actorId !== null && (typeof entry.actorId !== 'string' || !uuid.test(entry.actorId)))) {
      throw new Error('Invalid audit entry.');
    }
    const anonymous = entry.action === 'auth.otp.requested' || entry.action === 'auth.otp.failed';
    if (entry.actorId === null && !anonymous) throw new Error('Invalid audit entry.');
    const role = entry.action === 'auth.user_role.assign' || entry.action === 'auth.user_role.remove';
    const expectedEntity = role ? 'UserRole' : entry.action.startsWith('auth.otp.') ? 'OtpChallenge' :
      entry.action === 'auth.user.created' ? 'User' : 'AuthSession';
    if (entry.entityType !== expectedEntity || typeof entry.entityId !== 'string' ||
        (role ? !entry.entityId.split(':').every(part => uuid.test(part)) || entry.entityId.split(':').length !== 2 : !uuid.test(entry.entityId))) {
      throw new Error('Invalid audit entry.');
    }
    let beforeSummary: Record<string, unknown>;
    let afterSummary: Record<string, unknown>;
    switch (entry.action) {
      case 'auth.user_role.assign':
      case 'auth.user_role.remove':
        beforeSummary = exact(entry.beforeSummary, { assigned: value => typeof value === 'boolean' });
        afterSummary = exact(entry.afterSummary, { assigned: value => typeof value === 'boolean' });
        break;
      case 'auth.otp.requested':
        beforeSummary = exact(entry.beforeSummary, { exists: is(false) });
        afterSummary = exact(entry.afterSummary, { exists: is(true), attemptLimit: count(20, 1) });
        break;
      case 'auth.otp.failed':
        beforeSummary = exact(entry.beforeSummary, { failedAttempts: count(20) });
        afterSummary = exact(entry.afterSummary, {
          failedAttempts: count(20), outcome: value => ['invalid', 'expired', 'exhausted', 'consumed'].includes(value as string),
        });
        break;
      case 'auth.otp.consumed':
        beforeSummary = exact(entry.beforeSummary, { consumed: is(false) });
        afterSummary = exact(entry.afterSummary, { consumed: is(true) });
        break;
      case 'auth.user.created':
        beforeSummary = exact(entry.beforeSummary, { exists: is(false) });
        afterSummary = exact(entry.afterSummary, { exists: is(true) });
        break;
      case 'auth.session.issued':
        beforeSummary = exact(entry.beforeSummary, { active: is(false) });
        afterSummary = exact(entry.afterSummary, { active: is(true), authenticationMethod: is('MOBILE_OTP') });
        break;
      case 'auth.session.rotated':
        beforeSummary = exact(entry.beforeSummary, { active: is(true) });
        afterSummary = exact(entry.afterSummary, { active: is(false), authenticationMethod: is('MOBILE_OTP') });
        break;
      case 'auth.session.revoked':
        beforeSummary = exact(entry.beforeSummary, { active: is(true) });
        afterSummary = exact(entry.afterSummary, { active: is(false), revokedCount: count(1_000_000) });
        break;
      default:
        throw new Error('Invalid audit entry.');
    }
    return {
      actorId: entry.actorId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId,
      beforeSummary, afterSummary,
      ...(entry.correlationId === undefined ? {} : { correlationId: entry.correlationId }),
    } as AuditEntry;
  }
}
