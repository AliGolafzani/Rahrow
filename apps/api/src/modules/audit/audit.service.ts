import { Injectable } from '@nestjs/common';

// Deliberately bounded foundation summaries; not the final product event catalog.
export interface AuditSummary { assigned: boolean }
export interface AuditEntry {
  actorId: string;
  action: 'auth.user_role.assign' | 'auth.user_role.remove';
  entityType: 'UserRole';
  entityId: string;
  beforeSummary: AuditSummary;
  afterSummary: AuditSummary;
  correlationId?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuditService {
  sanitize(entry: AuditEntry): AuditEntry {
    if (!entry || !uuid.test(entry.actorId) || entry.entityType !== 'UserRole' ||
        !['auth.user_role.assign', 'auth.user_role.remove'].includes(entry.action) ||
        !/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(entry.entityId) ||
        (entry.correlationId !== undefined && !uuid.test(entry.correlationId))) {
      throw new Error('Invalid audit entry.');
    }
    const summary = (value: AuditSummary): AuditSummary => {
      if (!value || Object.keys(value).length !== 1 || typeof value.assigned !== 'boolean') {
        throw new Error('Invalid audit summary.');
      }
      return { assigned: value.assigned };
    };
    if (Object.keys(entry).some(key => !['actorId', 'action', 'entityType', 'entityId', 'beforeSummary', 'afterSummary', 'correlationId'].includes(key))) {
      throw new Error('Invalid audit entry.');
    }
    return {
      actorId: entry.actorId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId,
      beforeSummary: summary(entry.beforeSummary), afterSummary: summary(entry.afterSummary),
      ...(entry.correlationId === undefined ? {} : { correlationId: entry.correlationId }),
    };
  }
}
