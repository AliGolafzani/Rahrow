import { randomUUID } from 'node:crypto';

/**
 * Browser-only contract substitute, never production persistence or database evidence.
 * The real AUTH-02 service, HTTP boundary, MAC and Fake delivery remain in use.
 * Deliberately not exported from any runtime module or package entrypoint.
 */
export function createContractStore() {
  let challenges = new Map();
  let sessions = new Map();
  let people = new Map();
  const rates = new Map();
  const repository = {
    async useRateLimit(input) {
      const key = `${input.bucketKey}:${input.windowStart.toISOString()}`;
      const count = rates.get(key) ?? 0;
      if (count >= input.limit) return false;
      rates.set(key, count + 1);
      return true;
    },
    async withTransaction(operation) {
      const snapshot = globalThis.structuredClone({ challenges, sessions, people });
      try { return await operation({}); }
      catch (error) {
        ({ challenges, sessions, people } = snapshot);
        throw error;
      }
    },
    async lockOtpTarget() {},
    async otpRequestAvailability(_, input, clock) {
      const matching = [...challenges.values()].filter(row => row.targetDigest === input.targetDigest);
      const latest = matching.sort((a, b) => b.createdAt - a.createdAt)[0];
      const active = matching.filter(row => !row.consumedAt && row.expiresAt > clock() && row.failedAttempts < row.attemptLimit);
      let retryMs = latest ? Math.max(0, latest.createdAt.getTime() + input.cooldownMs - clock().getTime()) : 0;
      if (active.length >= input.maxActiveChallenges) retryMs = Math.max(retryMs, Math.min(...active.map(row => row.expiresAt.getTime())) - clock().getTime());
      return retryMs > 0 ? { allowed: false, retryAfterSeconds: Math.ceil(retryMs / 1000) } : { allowed: true };
    },
    async createOtpChallenge(_, input) { challenges.set(input.id, { ...input, failedAttempts: 0, consumedAt: null }); },
    async consumeOtpInTransaction(_, challengeId, targetDigest, code, mac, clock) {
      const row = challenges.get(challengeId);
      if (!row || row.targetDigest !== targetDigest) return { status: 'invalid' };
      const counts = { failedAttempts: row.failedAttempts, previousFailedAttempts: row.failedAttempts };
      if (row.consumedAt) return { status: 'already-consumed', ...counts };
      if (row.expiresAt <= clock()) return { status: 'expired', ...counts };
      if (row.failedAttempts >= row.attemptLimit) return { status: 'exhausted', ...counts };
      if (!mac.verifyCode({ challengeId, targetDigest }, code, row.codeMac)) {
        row.failedAttempts++;
        return { status: 'invalid', previousFailedAttempts: counts.failedAttempts, failedAttempts: row.failedAttempts };
      }
      row.consumedAt = clock();
      return { status: 'consumed', expiresAt: row.expiresAt };
    },
    async issueMobileSession(_, input) {
      const session = { ...input, id: randomUUID(), rootId: null, revokedAt: null };
      session.rootId = session.id;
      sessions.set(input.tokenDigest, session);
      return session;
    },
    async lookupMobileSession(digest, clock) {
      const session = sessions.get(digest);
      if (!session || session.revokedAt) return { status: 'invalid' };
      if (session.expiresAt <= clock()) return { status: 'expired' };
      return { status: 'valid', session };
    },
    async findSessionFamily(digest) {
      const session = sessions.get(digest);
      return session ? { rootId: session.rootId } : null;
    },
    async rotateMobileSession(digest, nextDigest, clock) {
      const result = await repository.lookupMobileSession(digest, clock);
      if (result.status !== 'valid') return null;
      const previous = result.session;
      previous.revokedAt = clock();
      const next = { ...previous, id: randomUUID(), tokenDigest: nextDigest, revokedAt: null };
      sessions.set(nextDigest, next);
      return next;
    },
    async revokeSession(digest, clock) {
      const session = sessions.get(digest);
      if (!session) return false;
      for (const row of sessions.values()) if (row.rootId === session.rootId) row.revokedAt = clock();
      return true;
    },
  };
  const users = {
    async findOrCreateMobile(_, mobile) {
      const found = [...people.values()].find(person => person.mobile === mobile);
      if (found) return { user: found, created: false };
      const user = { id: randomUUID(), mobile, email: null, firstName: null, lastName: null, birthDate: null, displayName: null, avatar: null };
      people.set(user.id, user);
      return { user, created: true };
    },
    async authenticatedSelf(id) { return people.get(id) ?? null; },
  };
  return { repository, users, audit: { async append() {} } };
}
