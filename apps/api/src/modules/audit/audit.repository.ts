import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import { AuditService } from './audit.service.js';
import type { AuditEntry } from './audit.service.js';

@Injectable()
export class AuditRepository {
  constructor(private readonly summaries: AuditService) {}

  /** Append-only. Caller must supply the transaction of the sensitive mutation. */
  async append(transaction: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const safe = this.summaries.sanitize(entry);
    await transaction.auditLog.create({ data: {
      ...safe, beforeSummary: { ...safe.beforeSummary }, afterSummary: { ...safe.afterSummary },
    } });
  }
}
