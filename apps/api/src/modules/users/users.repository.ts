import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.ts';
import { PrismaService } from '../../database/prisma.service.js';
import { assertCanonicalMobile } from '../auth/auth.security.js';
import { toPublicProfile } from './public-profile.js';
import { authenticatedSelfSelect, toAuthenticatedSelf } from './authenticated-self.js';

@Injectable()
export class UsersRepository {
  constructor(private readonly database: PrismaService) {}

  /** Persistence only. This is not registration, onboarding, or a grant of access. */
  async create(mobile: string): Promise<{ id: string }> {
    return this.database.client.user.create({
      data: { mobile: assertCanonicalMobile(mobile) }, select: { id: true },
    });
  }

  /** Only invoked after successful proof, inside the caller's success transaction. */
  async findOrCreateMobile(transaction: Prisma.TransactionClient, mobile: string, clock: () => Date = () => new Date()) {
    const canonical = assertCanonicalMobile(mobile);
    const now = clock();
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid security clock.');
    // Unlike a caught unique violation, ON CONFLICT does not abort this transaction.
    // A concurrent winner may block this statement; callers must recheck OTP expiry afterward.
    const inserted = await transaction.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "User" ("id", "mobile", "createdAt", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${canonical}, ${now}, ${now})
      ON CONFLICT ("mobile") DO NOTHING RETURNING "id"`;
    const user = await transaction.user.findUnique({ where: { mobile: canonical }, select: authenticatedSelfSelect });
    if (!user) throw new Error('Authentication persistence unavailable.');
    return { user: toAuthenticatedSelf(user), created: inserted.length === 1 };
  }

  async authenticatedSelf(userId: string) {
    const user = await this.database.client.user.findUnique({ where: { id: userId }, select: authenticatedSelfSelect });
    return user ? toAuthenticatedSelf(user) : null;
  }

  async publicProfile(userId: string) {
    const profile = await this.database.client.user.findUnique({
      where: { id: userId }, select: { displayName: true, avatar: true },
    });
    return profile ? toPublicProfile(profile) : null;
  }
}
