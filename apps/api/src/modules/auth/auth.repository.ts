import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService, type AuditEntry } from '../audit/audit.service.js';
import type { OtpMac } from './auth.security.js';

export type TimeSource = Date | (() => Date);
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
export interface OtpChallengeInput {
  id: string; targetDigest: string; codeMac: string; createdAt: Date; expiresAt: Date; attemptLimit: number;
}
export type OtpConsumptionResult =
  | { status: 'consumed'; expiresAt: Date }
  | { status: 'invalid' | 'expired' | 'exhausted' | 'already-consumed'; failedAttempts?: number; previousFailedAttempts?: number };
interface SessionIdentity { id: string; userId: string; expiresAt: Date }
export type MobileSessionLookup = { status: 'valid'; session: SessionIdentity } | { status: 'invalid' | 'expired' };

@Injectable()
export class AuthRepository {
  private readonly audit = new AuditService();

  constructor(private readonly database: PrismaService) {}

  /** No retry: a delivery side effect may have already occurred inside this transaction. */
  withTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
    return this.database.client.$transaction(operation, { timeout: options?.timeoutMs ?? 10_000, maxWait: 5_000, isolationLevel: 'ReadCommitted' });
  }

  async lockOtpTarget(transaction: Prisma.TransactionClient, targetDigest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(targetDigest)) throw new Error('Invalid OTP persistence input.');
    // Digest-only lock namespace: canonical mobile is never sent to the lock manager.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'rahrow:otp:target-lock:v1:' + targetDigest}, 0))`;
  }

  /** The caller must hold lockOtpTarget for this target until insert/delivery/audit commit. */
  async otpRequestAvailability(transaction: Prisma.TransactionClient, input: {
    targetDigest: string; cooldownMs: number; maxActiveChallenges: number;
  }, clock?: TimeSource): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    if (!/^[a-f0-9]{64}$/.test(input.targetDigest) || !Number.isSafeInteger(input.cooldownMs) || input.cooldownMs < 0 ||
        !Number.isSafeInteger(input.maxActiveChallenges) || input.maxActiveChallenges < 1 || input.maxActiveChallenges > 100) {
      throw new Error('Invalid OTP persistence input.');
    }
    const latest = await transaction.otpChallenge.findFirst({
      where: { targetDigest: input.targetDigest }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
    });
    const observedAt = currentTime(clock);
    const active = await transaction.$queryRaw<Array<{ expiresAt: Date }>>`
      SELECT "expiresAt" FROM "OtpChallenge"
      WHERE "targetDigest" = ${input.targetDigest} AND "consumedAt" IS NULL
        AND "expiresAt" > ${observedAt} AND "failedAttempts" < "attemptLimit"`;
    const now = currentTime(clock);
    let retryMs = latest ? Math.max(0, latest.createdAt.getTime() + input.cooldownMs - now.getTime()) : 0;
    const activeExpiries = active.map(row => row.expiresAt.getTime()).filter(expiry => expiry > now.getTime());
    if (activeExpiries.length >= input.maxActiveChallenges) {
      retryMs = Math.max(retryMs, Math.min(...activeExpiries) - now.getTime());
    }
    return retryMs > 0 ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) } : { allowed: true };
  }

  async createOtpChallenge(transaction: Prisma.TransactionClient, input: OtpChallengeInput): Promise<void> {
    await transaction.otpChallenge.create({ data: {
      id: input.id, targetDigest: input.targetDigest, codeMac: input.codeMac, createdAt: input.createdAt,
      expiresAt: input.expiresAt, attemptLimit: input.attemptLimit,
    }, select: { id: true } });
  }

  /** Matched failed attempts return normally so the caller can commit them before returning an HTTP error. */
  async consumeOtpInTransaction(transaction: Prisma.TransactionClient, challengeId: string, targetDigest: string,
    code: string, mac: OtpMac, clock?: TimeSource): Promise<OtpConsumptionResult> {
    const rows = await transaction.$queryRaw<Array<{
      id: string; targetDigest: string; codeMac: string; expiresAt: Date;
      consumedAt: Date | null; failedAttempts: number; attemptLimit: number;
    }>>`SELECT "id", "targetDigest", "codeMac", "expiresAt", "consumedAt", "failedAttempts", "attemptLimit"
        FROM "OtpChallenge" WHERE "id" = ${challengeId}::uuid FOR UPDATE`;
    const challenge = rows[0];
    const now = currentTime(clock);
    // A caller presenting another target cannot inspect or exhaust this challenge.
    if (!challenge || challenge.targetDigest !== targetDigest) return { status: 'invalid' };
    const counters = { failedAttempts: challenge.failedAttempts, previousFailedAttempts: challenge.failedAttempts };
    if (challenge.consumedAt) return { status: 'already-consumed', ...counters };
    if (challenge.expiresAt <= now) return { status: 'expired', ...counters };
    if (challenge.failedAttempts >= challenge.attemptLimit) return { status: 'exhausted', ...counters };
    if (!mac.verifyCode({ challengeId, targetDigest }, code, challenge.codeMac)) {
      await transaction.otpChallenge.update({ where: { id: challengeId }, data: { failedAttempts: { increment: 1 } } });
      return { status: 'invalid', previousFailedAttempts: challenge.failedAttempts, failedAttempts: challenge.failedAttempts + 1 };
    }
    await transaction.otpChallenge.update({ where: { id: challengeId }, data: { consumedAt: now } });
    return { status: 'consumed', expiresAt: challenge.expiresAt };
  }

  /** Compatibility primitive; complete login must use the caller-owned transaction helper. */
  async consumeOtp(challengeId: string, targetDigest: string, code: string, mac: OtpMac, clock?: TimeSource): Promise<boolean> {
    return this.withTransaction(async transaction =>
      (await this.consumeOtpInTransaction(transaction, challengeId, targetDigest, code, mac, clock)).status === 'consumed');
  }

  async issueMobileSession(transaction: Prisma.TransactionClient, input: { userId: string; tokenDigest: string; expiresAt: Date }, clock?: TimeSource) {
    const now = currentTime(clock);
    if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt <= now) throw new Error('Invalid session expiry.');
    return transaction.authSession.create({
      data: { userId: input.userId, tokenDigest: input.tokenDigest, expiresAt: input.expiresAt, authenticationMethod: 'MOBILE_OTP', createdAt: now },
      select: { id: true, userId: true, expiresAt: true },
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

  async lookupMobileSession(tokenDigest: string, clock?: TimeSource): Promise<MobileSessionLookup> {
    const session = await this.database.client.authSession.findFirst({
      where: { tokenDigest, authenticationMethod: 'MOBILE_OTP' },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    if (!session || session.revokedAt) return { status: 'invalid' };
    if (session.expiresAt <= currentTime(clock)) return { status: 'expired' };
    return { status: 'valid', session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt } };
  }

  private async sessionFamily(transaction: Prisma.TransactionClient, tokenDigest: string): Promise<{ rootId: string } | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE ancestors AS (
        SELECT "id", "rotatedFromId", "userId" FROM "AuthSession"
        WHERE "tokenDigest" = ${tokenDigest} AND "authenticationMethod" = 'MOBILE_OTP'
        UNION
        SELECT parent."id", parent."rotatedFromId", parent."userId" FROM "AuthSession" parent
        JOIN ancestors child ON parent."id" = child."rotatedFromId" AND parent."userId" = child."userId"
        WHERE parent."authenticationMethod" = 'MOBILE_OTP'
      ) SELECT "id" FROM ancestors WHERE "rotatedFromId" IS NULL`;
    return rows[0] ? { rootId: rows[0].id } : null;
  }

  /** Stable admission key, including a known stale ancestor, without revealing any token. */
  async findSessionFamily(tokenDigest: string): Promise<{ rootId: string } | null> {
    return this.sessionFamily(this.database.client, tokenDigest);
  }

  private async lockSessionFamily(transaction: Prisma.TransactionClient, tokenDigest: string): Promise<{ rootId: string } | null> {
    const family = await this.sessionFamily(transaction, tokenDigest);
    if (!family) return null;
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "AuthSession" WHERE "id" = ${family.rootId}::uuid FOR UPDATE`;
    return locked.length === 1 ? family : null;
  }

  private async appendAudit(transaction: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const safe = this.audit.sanitize(entry);
    await transaction.auditLog.create({ data: {
      ...safe, beforeSummary: { ...safe.beforeSummary }, afterSummary: { ...safe.afterSummary },
    } });
  }

  /** Every rotation and logout locks the same immutable root before reading mutable family state. */
  async rotateMobileSession(tokenDigest: string, newDigest: string, clock?: TimeSource, correlationId?: string) {
    return this.withTransaction(async transaction => {
      const family = await this.lockSessionFamily(transaction, tokenDigest);
      if (!family) return null;
      const rows = await transaction.$queryRaw<Array<{
        id: string; userId: string; authenticationMethod: string; revokedAt: Date | null; expiresAt: Date;
      }>>`SELECT "id", "userId", "authenticationMethod", "revokedAt", "expiresAt"
          FROM "AuthSession" WHERE "tokenDigest" = ${tokenDigest}`;
      const previous = rows[0];
      const now = currentTime(clock);
      if (!previous || previous.authenticationMethod !== 'MOBILE_OTP' || previous.revokedAt || previous.expiresAt <= now) return null;
      await transaction.authSession.update({ where: { id: previous.id }, data: { revokedAt: now } });
      const successor = await transaction.authSession.create({
        data: { userId: previous.userId, authenticationMethod: 'MOBILE_OTP', tokenDigest: newDigest,
          createdAt: now, expiresAt: previous.expiresAt, rotatedFromId: previous.id },
        select: { id: true, userId: true, expiresAt: true },
      });
      await this.appendAudit(transaction, {
        actorId: previous.userId, action: 'auth.session.rotated', entityType: 'AuthSession', entityId: previous.id,
        beforeSummary: { active: true }, afterSummary: { active: false, authenticationMethod: 'MOBILE_OTP' },
        ...(correlationId === undefined ? {} : { correlationId }),
      });
      return successor;
    });
  }

  /** Known stale ancestors revoke their current descendants; independent login families are untouched. */
  async revokeSession(tokenDigest: string, clock?: TimeSource, correlationId?: string): Promise<boolean> {
    return this.withTransaction(async transaction => {
      const family = await this.lockSessionFamily(transaction, tokenDigest);
      if (!family) return false;
      const now = currentTime(clock);
      const revoked = await transaction.$queryRaw<Array<{ id: string; userId: string }>>`
        WITH RECURSIVE family AS (
          SELECT "id", "userId" FROM "AuthSession" WHERE "id" = ${family.rootId}::uuid
          UNION
          SELECT child."id", child."userId" FROM "AuthSession" child
          JOIN family parent ON child."rotatedFromId" = parent."id" AND child."userId" = parent."userId"
          WHERE child."authenticationMethod" = 'MOBILE_OTP'
        )
        UPDATE "AuthSession" session SET "revokedAt" = ${now}
        FROM family WHERE session."id" = family."id" AND session."revokedAt" IS NULL
        RETURNING session."id", session."userId"`;
      if (revoked.length === 0) return false;
      await this.appendAudit(transaction, {
        actorId: revoked[0]!.userId, action: 'auth.session.revoked', entityType: 'AuthSession', entityId: family.rootId,
        beforeSummary: { active: true }, afterSummary: { active: false, revokedCount: revoked.length },
        ...(correlationId === undefined ? {} : { correlationId }),
      });
      return true;
    });
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
