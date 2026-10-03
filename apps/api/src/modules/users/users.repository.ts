import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertCanonicalMobile } from '../auth/auth.security.js';
import { toPublicProfile } from './public-profile.js';

@Injectable()
export class UsersRepository {
  constructor(private readonly database: PrismaService) {}

  /** Persistence only. This is not registration, onboarding, or a grant of access. */
  async create(mobile: string): Promise<{ id: string }> {
    return this.database.client.user.create({
      data: { mobile: assertCanonicalMobile(mobile) }, select: { id: true },
    });
  }

  async publicProfile(userId: string) {
    const profile = await this.database.client.user.findUnique({
      where: { id: userId }, select: { displayName: true, avatar: true },
    });
    return profile ? toPublicProfile(profile) : null;
  }
}
