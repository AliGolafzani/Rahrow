import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditRepository } from '../audit/audit.repository.js';

@Injectable()
export class RbacRepository {
  constructor(private readonly database: PrismaService, private readonly audit: AuditRepository) {}

  async hasCapability(userId: string, capability: string): Promise<boolean> {
    const assignment = await this.database.client.rolePermission.findFirst({
      where: { permission: { key: capability }, role: { userRoles: { some: { userId } } } },
      select: { roleId: true },
    });
    return assignment !== null;
  }

  /** Internal persistence boundary only, with no HTTP management surface or matrix. */
  async assignUserRole(input: { actorId: string; userId: string; roleId: string; correlationId?: string }): Promise<void> {
    await this.database.client.$transaction(async transaction => {
      await transaction.userRole.create({ data: { userId: input.userId, roleId: input.roleId } });
      await this.audit.append(transaction, {
        actorId: input.actorId, action: 'auth.user_role.assign', entityType: 'UserRole',
        entityId: `${input.userId}:${input.roleId}`, beforeSummary: { assigned: false }, afterSummary: { assigned: true },
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      });
    });
  }
}
