import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { OtpMac } from './auth.security.js';

type TimeSource = Date | (() => Date);
function currentTime(source?: TimeSource): Date {
  const now = typeof source === 'function' ? source() : source ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid security clock.');
  return now;
}

export interface RateLimitInput {
  bucketKey: string;
  scope: 'otp-challenge' | 'otp-verification' | 'session';
  windowStart: Date;
  expiresAt: Date;
  limit: number;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly database: PrismaService) {}

  /** Primitive only: no delivery, account creation, login, or session issuance. */
  async consumeOtp(challengeId: string, targetDigest: string, code: string, mac: OtpMac, clock?: TimeSource): Promise<boolean> {
    return this.database.client.$transaction(async transaction => {
      const rows = await transaction.$queryRaw<Array<{
        id: string; targetDigest: string; codeMac: string; expiresAt: Date;
        consumedAt: Date | null; failedAttempts: number; attemptLimit: number;
      }>>`SELECT "id", "targetDigest", "codeMac", "expiresAt", "consumedAt", "failedAttempts", "attemptLimit"
          FROM "OtpChallenge" WHERE "id" = ${challengeId}::uuid FOR UPDATE`;
      const challenge = rows[0];
      // Evaluate expiry after lock acquisition, never at request/transaction entry.
      const now = currentTime(clock);
      if (!challenge || challenge.consumedAt || challenge.expiresAt <= now || challenge.failedAttempts >= challenge.attemptLimit) return false;
      const valid = challenge.targetDigest === targetDigest &&
        mac.verifyCode({ challengeId, targetDigest }, code, challenge.codeMac);
      if (!valid) {
        await transaction.otpChallenge.update({ where: { id: challengeId }, data: { failedAttempts: { increment: 1 } } });
        return false;
      }
      await transaction.otpChallenge.update({ where: { id: challengeId }, data: { consumedAt: now } });
      return true;
    });
  }

  async findMobileSession(tokenDigest: string, clock?: TimeSource) {
    const now = currentTime(clock);
    const session = await this.database.client.authSession.findFirst({
      where: { tokenDigest, revokedAt: null, expiresAt: { gt: now }, authenticationMethod: 'MOBILE_OTP' },
      select: { id: true, userId: true, expiresAt: true },
    });
    return session && session.expiresAt > currentTime(clock) ? session : null;
  }

  /** Rotation preserves original assurance and absolute expiry. No issuance/upgrades. */
  async rotateMobileSession(tokenDigest: string, newDigest: string, clock?: TimeSource) {
    return this.database.client.$transaction(async transaction => {
      const rows = await transaction.$queryRaw<Array<{
        id: string; userId: string; authenticationMethod: string; revokedAt: Date | null; expiresAt: Date;
      }>>`SELECT "id", "userId", "authenticationMethod", "revokedAt", "expiresAt"
          FROM "AuthSession" WHERE "tokenDigest" = ${tokenDigest} FOR UPDATE`;
      const previous = rows[0];
      const now = currentTime(clock);
      if (!previous || previous.authenticationMethod !== 'MOBILE_OTP' || previous.revokedAt || previous.expiresAt <= now) return null;
      await transaction.authSession.update({ where: { id: previous.id }, data: { revokedAt: now } });
      return transaction.authSession.create({
        data: { userId: previous.userId, authenticationMethod: 'MOBILE_OTP', tokenDigest: newDigest, expiresAt: previous.expiresAt, rotatedFromId: previous.id },
        select: { id: true, userId: true, expiresAt: true },
      });
    });
  }

  async revokeSession(tokenDigest: string, now = new Date()): Promise<boolean> {
    const result = await this.database.client.authSession.updateMany({
      where: { tokenDigest, revokedAt: null }, data: { revokedAt: now },
    });
    return result.count === 1;
  }

  /** A storage compare-and-set, NOT TOTP verification or authentication success. */
  async advanceTotpReplayCounter(userId: string, step: bigint): Promise<boolean> {
    if (step < 0n || step > 9_223_372_036_854_775_807n) throw new Error('Invalid replay counter.');
    const updated = await this.database.client.adminCredential.updateMany({
      where: { userId, OR: [{ lastAcceptedTotpStep: null }, { lastAcceptedTotpStep: { lt: step } }] },
      data: { lastAcceptedTotpStep: step },
    });
    return updated.count === 1;
  }

  async useRateLimit(input: RateLimitInput, clock?: TimeSource): Promise<boolean> {
    const now = currentTime(clock);
    if (!/^[a-f0-9]{64}$/.test(input.bucketKey) || !['otp-challenge', 'otp-verification', 'session'].includes(input.scope) ||
        !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 10_000 ||
        !Number.isFinite(input.windowStart.getTime()) || !Number.isFinite(input.expiresAt.getTime()) ||
        input.windowStart > now || input.expiresAt <= now || input.expiresAt <= input.windowStart) {
      throw new Error('Invalid rate-limit configuration.');
    }
    const rows = await this.database.client.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "AuthRateLimitBucket" ("bucketKey", "scope", "windowStart", "count", "expiresAt")
      VALUES (${input.bucketKey}, ${input.scope}, ${input.windowStart}, 1, ${input.expiresAt})
      ON CONFLICT ("bucketKey", "scope", "windowStart") DO UPDATE SET "count" = "AuthRateLimitBucket"."count" + 1
      WHERE "AuthRateLimitBucket"."count" < ${input.limit}
        AND "AuthRateLimitBucket"."expiresAt" = ${input.expiresAt}
        AND "AuthRateLimitBucket"."expiresAt" > ${now}
      RETURNING "count"`;
    // A bucket that expired while the upsert waited must never admit a request.
    return rows.length === 1 && input.expiresAt > currentTime(clock);
  }
}
