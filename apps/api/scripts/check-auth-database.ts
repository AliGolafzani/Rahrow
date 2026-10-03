import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import process from 'node:process';
import { assertDisposableAuthTestEnvironment } from './auth-schema.ts';
import { getLocalDatabaseUrl, loadLocalEnvironment } from './local-database.ts';

let stage = 'disposable CI guard';

/** This is deliberately not part of npm test: only the owned disposable CI database may be mutated. */
async function checkAuthDatabase(): Promise<void> {
  assertDisposableAuthTestEnvironment(process.env);
  loadLocalEnvironment();
  getLocalDatabaseUrl();

  stage = 'compiled application imports';
  // Native Node strips types, but not Nest decorators. Exercise the same emitted code as runtime.
  const { PrismaService } = await import(new URL('../dist/database/prisma.service.js', import.meta.url).href) as typeof import('../src/database/prisma.service.js');
  const { AuthRepository } = await import(new URL('../dist/modules/auth/auth.repository.js', import.meta.url).href) as typeof import('../src/modules/auth/auth.repository.js');
  const { UsersRepository } = await import(new URL('../dist/modules/users/users.repository.js', import.meta.url).href) as typeof import('../src/modules/users/users.repository.js');
  const { AuditService } = await import(new URL('../dist/modules/audit/audit.service.js', import.meta.url).href) as typeof import('../src/modules/audit/audit.service.js');
  const { AuditRepository } = await import(new URL('../dist/modules/audit/audit.repository.js', import.meta.url).href) as typeof import('../src/modules/audit/audit.repository.js');
  const { RbacRepository } = await import(new URL('../dist/modules/rbac/rbac.repository.js', import.meta.url).href) as typeof import('../src/modules/rbac/rbac.repository.js');
  const security = await import(new URL('../dist/modules/auth/auth.security.js', import.meta.url).href) as typeof import('../src/modules/auth/auth.security.js');
  const database = new PrismaService();
  const prisma = database.client;
  const auth = new AuthRepository(database);
  const users = new UsersRepository(database);
  const audit = new AuditRepository(new AuditService());
  const rbac = new RbacRepository(database, audit);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 300_000);
  const createdAt = new Date(now.getTime() - 1_000);
  const mobile = `+999${randomInt(10_000_000, 99_999_999)}`;
  const mac = new security.OtpMac(randomBytes(32));
  const targetDigest = mac.targetDigest(mobile);
  const run = async (name: string, check: () => Promise<void>) => {
    stage = name;
    await check();
    console.log(`PASS: ${name}.`);
  };
  const hasCode = (code: string) => (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  const assertSingleInsert = (results: PromiseSettledResult<unknown>[]) => {
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of results) if (result.status === 'rejected') assert.ok(hasCode('P2002')(result.reason));
  };

  try {
    await run('local writable database identity', async () => {
      const [identity] = await prisma.$queryRaw<Array<{ database: string; username: string }>>`
        SELECT current_database() AS database, current_user AS username
      `;
      assert.equal(identity?.database, process.env.POSTGRES_DB);
      assert.equal(identity?.username, process.env.POSTGRES_USER);
      assert.equal(await prisma.user.count(), 0, 'The disposable database must contain no preexisting accounts.');
      assert.equal(await prisma.auditLog.count(), 0);
    });

    await run('concurrent duplicate canonical mobile creation', async () => {
      assertSingleInsert(await Promise.allSettled(Array.from({ length: 12 }, () => users.create(mobile))));
      assert.equal(await prisma.user.count({ where: { mobile } }), 1);
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { mobile } });
    const role = await prisma.role.create({ data: { key: `qa-role-${randomUUID()}` } });
    const permission = await prisma.permission.create({ data: { key: `qa.capability${randomUUID().replaceAll('-', '')}` } });

    await run('concurrent user-role and role-permission uniqueness with foreign-key enforcement', async () => {
      assertSingleInsert(await Promise.allSettled(Array.from({ length: 12 }, () => prisma.userRole.create({ data: { userId: user.id, roleId: role.id } }))));
      assertSingleInsert(await Promise.allSettled(Array.from({ length: 12 }, () => prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } }))));
      assert.equal(await prisma.userRole.count({ where: { userId: user.id, roleId: role.id } }), 1);
      assert.equal(await prisma.rolePermission.count({ where: { roleId: role.id, permissionId: permission.id } }), 1);
      await assert.rejects(prisma.userRole.create({ data: { userId: randomUUID(), roleId: role.id } }), hasCode('P2003'));
      await assert.rejects(prisma.rolePermission.create({ data: { roleId: role.id, permissionId: randomUUID() } }), hasCode('P2003'));
      await assert.rejects(prisma.role.delete({ where: { id: role.id } }), hasCode('P2003'));
    });

    const challenge = async (overrides: { expiresAt?: Date; consumedAt?: Date; failedAttempts?: number; attemptLimit?: number } = {}) => {
      const id = randomUUID();
      const code = security.generateOtpCode();
      const codeMac = mac.codeMac({ challengeId: id, targetDigest }, code);
      await prisma.otpChallenge.create({ data: { id, targetDigest, codeMac, createdAt, expiresAt, attemptLimit: 5, ...overrides } });
      return { id, code, wrongCode: code === '000000' ? '111111' : '000000' };
    };

    await run('database constraints reject malformed mobile and impossible challenge state', async () => {
      await assert.rejects(prisma.user.create({ data: { mobile: '00999123456789' } }));
      const id = randomUUID();
      const codeMac = mac.codeMac({ challengeId: id, targetDigest }, security.generateOtpCode());
      for (const invalid of [
        { failedAttempts: -1 }, { failedAttempts: 6 }, { attemptLimit: 0 }, { attemptLimit: 21 },
        { expiresAt: createdAt }, { consumedAt: expiresAt },
      ]) {
        await assert.rejects(prisma.otpChallenge.create({ data: {
          id, targetDigest, codeMac, createdAt, expiresAt, attemptLimit: 5, ...invalid,
        } }));
        assert.equal(await prisma.otpChallenge.count({ where: { id } }), 0);
      }
    });

    await run('OTP expiry, target binding, unknown and consumed rejection', async () => {
      const expired = await challenge({ expiresAt: now });
      const consumed = await challenge({ consumedAt: new Date(now.getTime() - 1) });
      const unconsumed = await challenge();
      assert.equal(await auth.consumeOtp(expired.id, targetDigest, expired.code, mac, now), false);
      assert.equal(await auth.consumeOtp(consumed.id, targetDigest, consumed.code, mac, now), false);
      assert.equal(await auth.consumeOtp(randomUUID(), targetDigest, unconsumed.code, mac, now), false);
      assert.equal(await auth.consumeOtp(unconsumed.id, mac.targetDigest('+999123456789'), unconsumed.code, mac, now), false);
      assert.equal(await auth.consumeOtp(unconsumed.id, targetDigest, unconsumed.code, mac, now), true);
      assert.equal(await auth.consumeOtp(unconsumed.id, targetDigest, unconsumed.code, mac, now), false);
    });

    await run('OTP attempt limits remain bounded under concurrent wrong codes', async () => {
      const attempt = await challenge();
      const results = await Promise.all(Array.from({ length: 12 }, () => auth.consumeOtp(attempt.id, targetDigest, attempt.wrongCode, mac, now)));
      assert.ok(results.every(result => result === false));
      const stored = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: attempt.id } });
      assert.equal(stored.failedAttempts, stored.attemptLimit);
      assert.equal(stored.consumedAt, null);
      assert.equal(await auth.consumeOtp(attempt.id, targetDigest, attempt.code, mac, now), false);
    });

    await run('OTP concurrent consumption succeeds exactly once', async () => {
      const attempt = await challenge();
      const results = await Promise.all(Array.from({ length: 12 }, () => auth.consumeOtp(attempt.id, targetDigest, attempt.code, mac, now)));
      assert.equal(results.filter(Boolean).length, 1);
      const stored = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: attempt.id } });
      assert.equal(stored.failedAttempts, 0);
      assert.equal(stored.consumedAt?.getTime(), now.getTime());
      assert.notEqual(stored.codeMac, attempt.code);
    });

    await run('rate-limit atomic upsert permits only the configured concurrent count', async () => {
      const bucket = { bucketKey: mac.rateLimitDigest('otp', mobile), scope: 'otp-verification' as const, windowStart: createdAt, expiresAt, limit: 5 };
      const results = await Promise.all(Array.from({ length: 20 }, () => auth.useRateLimit(bucket, now)));
      assert.equal(results.filter(Boolean).length, bucket.limit);
      const stored = await prisma.authRateLimitBucket.findUniqueOrThrow({ where: { bucketKey_scope_windowStart: {
        bucketKey: bucket.bucketKey, scope: bucket.scope, windowStart: bucket.windowStart,
      } } });
      assert.equal(stored.count, bucket.limit);
      assert.equal(await auth.useRateLimit(bucket, now), false);
      await assert.rejects(auth.useRateLimit({ ...bucket, bucketKey: mac.rateLimitDigest('otp', randomUUID()), expiresAt: new Date(now.getTime() - 1) }, now), /Invalid rate-limit configuration/);
    });

    const session = async (overrides: { expiresAt?: Date; revokedAt?: Date; authenticationMethod?: 'MOBILE_OTP' | 'ADMIN_PASSWORD_TOTP' } = {}) => {
      const token = security.createSessionToken();
      const row = await prisma.authSession.create({ data: {
        userId: user.id, tokenDigest: token.digest, authenticationMethod: 'MOBILE_OTP', createdAt, expiresAt, ...overrides,
      } });
      return { row, token };
    };

    await run('session expiry, revocation, unknown tokens and unverified admin assurance fail closed', async () => {
      const expired = await session({ expiresAt: now });
      const revoked = await session({ revokedAt: new Date(now.getTime() - 1) });
      // A direct DB fixture exercises fail-closed handling; production exposes no admin issuance.
      const unverifiedAdmin = await session({ authenticationMethod: 'ADMIN_PASSWORD_TOTP' });
      for (const tokenDigest of [expired.token.digest, revoked.token.digest, unverifiedAdmin.token.digest, security.createSessionToken().digest]) {
        assert.equal(await auth.findMobileSession(tokenDigest, now), null);
        assert.equal(await auth.rotateMobileSession(tokenDigest, security.createSessionToken().digest, now), null);
      }
      const valid = await session();
      assert.equal((await auth.findMobileSession(valid.token.digest, now))?.userId, user.id);
      await assert.rejects(prisma.authSession.create({ data: {
        userId: user.id, tokenDigest: valid.token.digest, authenticationMethod: 'MOBILE_OTP', createdAt, expiresAt,
      } }), hasCode('P2002'));
      assert.equal(await auth.revokeSession(valid.token.digest, now), true);
      assert.equal(await auth.findMobileSession(valid.token.digest, now), null);
    });

    await run('failed session rotation rolls back predecessor revocation', async () => {
      const original = await session();
      const collision = await session();
      await assert.rejects(auth.rotateMobileSession(original.token.digest, collision.token.digest, now), hasCode('P2002'));
      assert.equal((await auth.findMobileSession(original.token.digest, now))?.id, original.row.id);
      assert.equal(await prisma.authSession.count({ where: { rotatedFromId: original.row.id } }), 0);
    });

    await run('session concurrent rotation has one successor and revokes its predecessor', async () => {
      const original = await session();
      const rotations = await Promise.all(Array.from({ length: 12 }, () => auth.rotateMobileSession(original.token.digest, security.createSessionToken().digest, now)));
      assert.equal(rotations.filter(Boolean).length, 1);
      const successors = await prisma.authSession.findMany({ where: { rotatedFromId: original.row.id } });
      assert.equal(successors.length, 1);
      assert.equal(successors[0]!.authenticationMethod, 'MOBILE_OTP');
      assert.equal(successors[0]!.userId, user.id);
      assert.equal(successors[0]!.expiresAt.getTime(), original.row.expiresAt.getTime());
      assert.equal(await auth.findMobileSession(original.token.digest, now), null);
      assert.equal((await auth.findMobileSession(successors[0]!.tokenDigest, now))?.userId, user.id);
    });

    await run('encrypted TOTP persistence and concurrent replay counter are atomic', async () => {
      const key = randomBytes(32);
      const secret = randomBytes(20);
      const cipher = new security.TotpSecretCipher({ activeKeyVersion: 'qa-ephemeral', keyLookup: version => version === 'qa-ephemeral' ? key : undefined });
      const envelope = cipher.encrypt(user.id, secret);
      await prisma.adminCredential.create({ data: {
        userId: user.id, passwordHash: await security.hashAdminPassword(randomBytes(32).toString('base64url')),
        totpCiphertext: Buffer.from(envelope.ciphertext, 'base64url'), totpNonce: Buffer.from(envelope.nonce, 'base64url'),
        totpAuthenticationTag: Buffer.from(envelope.authenticationTag, 'base64url'), totpKeyVersion: envelope.keyVersion,
      } });
      const stored = await prisma.adminCredential.findUniqueOrThrow({ where: { userId: user.id } });
      const persistedEnvelope = {
        ciphertext: Buffer.from(stored.totpCiphertext).toString('base64url'), nonce: Buffer.from(stored.totpNonce).toString('base64url'),
        authenticationTag: Buffer.from(stored.totpAuthenticationTag).toString('base64url'), keyVersion: stored.totpKeyVersion,
      };
      const decrypted = cipher.decrypt(user.id, persistedEnvelope);
      assert.deepEqual(decrypted, secret);
      assert.notDeepEqual(stored.totpCiphertext, secret);
      decrypted.fill(0);
      assert.throws(() => cipher.decrypt(randomUUID(), persistedEnvelope));
      const results = await Promise.all(Array.from({ length: 12 }, () => auth.advanceTotpReplayCounter(user.id, 100n)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await auth.advanceTotpReplayCounter(user.id, 99n), false);
      assert.equal(await auth.advanceTotpReplayCounter(user.id, 100n), false);
      assert.equal(await auth.advanceTotpReplayCounter(user.id, 101n), true);
      assert.equal(await auth.advanceTotpReplayCounter(randomUUID(), 102n), false);
      assert.equal((await prisma.adminCredential.findUniqueOrThrow({ where: { userId: user.id } })).lastAcceptedTotpStep, 101n);
      key.fill(0);
      secret.fill(0);
    });

    await run('capability assignments remain authoritative over role names and credentials', async () => {
      assert.equal(await rbac.hasCapability(user.id, permission.key), true);
      assert.equal(await rbac.hasCapability(user.id, `unknown-${randomUUID()}`), false);
      const unprivileged = await users.create('+99900000000');
      const namedRole = await prisma.role.create({ data: { key: 'super-admin' } });
      await prisma.userRole.create({ data: { userId: unprivileged.id, roleId: namedRole.id } });
      assert.equal(await rbac.hasCapability(unprivileged.id, permission.key), false);
      assert.equal(await rbac.hasCapability(randomUUID(), permission.key), false);
      // This account already has an AdminCredential. Removing the capability still removes access.
      await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } } });
      assert.equal(await rbac.hasCapability(user.id, permission.key), false);
    });

    await run('concurrent audited user-role assignment records exactly one mutation and audit', async () => {
      const assignedRole = await prisma.role.create({ data: { key: `qa-assignment-${randomUUID()}` } });
      const correlationId = randomUUID();
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => rbac.assignUserRole({
        actorId: user.id, userId: user.id, roleId: assignedRole.id, correlationId,
      })));
      assertSingleInsert(results);
      assert.equal(await prisma.userRole.count({ where: { userId: user.id, roleId: assignedRole.id } }), 1);
      const entries = await prisma.auditLog.findMany({ where: { correlationId } });
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.actorId, user.id);
      assert.equal(entries[0]!.entityId, `${user.id}:${assignedRole.id}`);
      assert.equal(entries[0]!.action, 'auth.user_role.assign');
      assert.deepEqual(entries[0]!.beforeSummary, { assigned: false });
      assert.deepEqual(entries[0]!.afterSummary, { assigned: true });
    });

    await run('audit failure rolls back the sensitive user-role assignment', async () => {
      const rollbackRole = await prisma.role.create({ data: { key: `qa-rollback-${randomUUID()}` } });
      const correlationId = randomUUID();
      await assert.rejects(rbac.assignUserRole({ actorId: randomUUID(), userId: user.id, roleId: rollbackRole.id, correlationId }), hasCode('P2003'));
      assert.equal(await prisma.userRole.count({ where: { userId: user.id, roleId: rollbackRole.id } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { correlationId } }), 0);
      await assert.rejects(rbac.assignUserRole({ actorId: user.id, userId: user.id, roleId: rollbackRole.id, correlationId: 'invalid' }), /Invalid audit entry/);
      assert.equal(await prisma.userRole.count({ where: { userId: user.id, roleId: rollbackRole.id } }), 0);
      const abort = new Error('Intentional disposable transaction rollback.');
      await assert.rejects(prisma.$transaction(async transaction => {
        await transaction.userRole.create({ data: { userId: user.id, roleId: rollbackRole.id } });
        await audit.append(transaction, {
          actorId: user.id, action: 'auth.user_role.assign', entityType: 'UserRole',
          entityId: `${user.id}:${rollbackRole.id}`, beforeSummary: { assigned: false }, afterSummary: { assigned: true }, correlationId,
        });
        throw abort;
      }), error => error === abort);
      assert.equal(await prisma.userRole.count({ where: { userId: user.id, roleId: rollbackRole.id } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { correlationId } }), 0);
    });

    console.log('PASS: Real AUTH-01 PostgreSQL invariant and concurrency checks; fixtures remain only in the owned disposable QA volume.');
  } finally {
    await database.onModuleDestroy();
  }
}

try {
  await checkAuthDatabase();
} catch {
  // Do not emit SQL, driver errors, authentication material, account data or assertion values.
  console.error(`FAIL: AUTH-01 database verification failed at ${stage}. Scoped CI cleanup must still run.`);
  process.exitCode = 1;
}
