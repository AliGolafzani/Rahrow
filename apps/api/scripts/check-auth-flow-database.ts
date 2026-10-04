import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import type { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';
import type { PrismaService as Database } from '../src/database/prisma.service.js';
import { assertDisposableAuthTestEnvironment } from './auth-schema.ts';
import { getLocalDatabaseUrl, loadLocalEnvironment } from './local-database.ts';

let stage = 'arguments and disposable CI guard';
const hasCode = (...codes: string[]) => (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && codes.includes(String(error.code));
const freshMobile = () => `+999${randomInt(100_000_000, 999_999_999)}`;
const freshIp = () => `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;

/** Only these projections may reach a restart checkpoint. No bearers, OTPs, MACs, PII or keys. */
async function persistedState(prisma: PrismaClient): Promise<string> {
  const [users, challenges, sessions, audits, rates] = await Promise.all([
    prisma.user.findMany({ select: { id: true, createdAt: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.otpChallenge.findMany({ select: {
      id: true, createdAt: true, expiresAt: true, consumedAt: true, failedAttempts: true, attemptLimit: true,
    }, orderBy: { id: 'asc' } }),
    prisma.authSession.findMany({ select: {
      id: true, userId: true, createdAt: true, expiresAt: true, revokedAt: true,
      rotatedFromId: true, authenticationMethod: true,
    }, orderBy: { id: 'asc' } }),
    prisma.auditLog.findMany({ select: {
      id: true, actorId: true, action: true, entityType: true, entityId: true,
      beforeSummary: true, afterSummary: true, correlationId: true, occurredAt: true,
    }, orderBy: { id: 'asc' } }),
    prisma.authRateLimitBucket.findMany({ select: {
      scope: true, windowStart: true, count: true, expiresAt: true,
    }, orderBy: [{ scope: 'asc' }, { windowStart: 'asc' }, { count: 'asc' }, { expiresAt: 'asc' }] }),
  ]);
  return `${JSON.stringify({ version: 1, users, challenges, sessions, audits, rates }, null, 2)}\n`;
}

type TransactionWork = (transaction: Prisma.TransactionClient) => Promise<unknown>;
/** Inject only at the test transaction boundary; every ordinary query still reaches PostgreSQL. */
function interceptTransactions(database: Database,
  hook: (transaction: Prisma.TransactionClient, work: TransactionWork) => Promise<unknown>): Database {
  const original = database.client;
  const client = new Proxy(original, {
    get(target, key) {
      if (key === '$transaction') return (work: TransactionWork, options?: { maxWait?: number; timeout?: number }) =>
        original.$transaction(transaction => hook(transaction, work), options);
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(database, {
    get(target, key) {
      if (key === 'client') return client;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** This runner never relaxes or emulates the existing disposable GitHub database guard. */
async function checkAuthFlowDatabase(): Promise<void> {
  const [snapshotAction, snapshotPath, ...remaining] = process.argv.slice(2);
  assert.ok(!remaining.length && ((!snapshotAction && !snapshotPath) ||
    (snapshotPath && ['--write-snapshot', '--expect-snapshot'].includes(snapshotAction!))));
  assertDisposableAuthTestEnvironment(process.env);
  loadLocalEnvironment();
  getLocalDatabaseUrl();
  const { PrismaService } = await import(new URL('../dist/database/prisma.service.js', import.meta.url).href) as typeof import('../src/database/prisma.service.js');
  const database = new PrismaService();
  const secondDatabase = new PrismaService();
  const prisma = database.client;
  try {
    stage = 'local writable database identity';
    const [identity] = await prisma.$queryRaw<Array<{ database: string; username: string }>>`
      SELECT current_database() AS database, current_user AS username
    `;
    assert.equal(identity?.database, process.env.POSTGRES_DB);
    assert.equal(identity?.username, process.env.POSTGRES_USER);
    if (snapshotAction === '--expect-snapshot') {
      stage = 'AUTH-02 persisted state after actual PostgreSQL restart';
      assert.equal(await persistedState(prisma), await readFile(snapshotPath!, 'utf8'));
      console.log('PASS: AUTH-02 users, independent challenges, session families, audits and rate state survived restart unchanged; checkpoint contains no bearer artifacts.');
      return;
    }

    const { AuthRepository } = await import(new URL('../dist/modules/auth/auth.repository.js', import.meta.url).href) as typeof import('../src/modules/auth/auth.repository.js');
    const { UsersRepository } = await import(new URL('../dist/modules/users/users.repository.js', import.meta.url).href) as typeof import('../src/modules/users/users.repository.js');
    const { AuditRepository } = await import(new URL('../dist/modules/audit/audit.repository.js', import.meta.url).href) as typeof import('../src/modules/audit/audit.repository.js');
    const { AuditService } = await import(new URL('../dist/modules/audit/audit.service.js', import.meta.url).href) as typeof import('../src/modules/audit/audit.service.js');
    const { AuthConfig, DEFAULT_AUTH_RATE_LIMITS } = await import(new URL('../dist/modules/auth/auth.config.js', import.meta.url).href) as typeof import('../src/modules/auth/auth.config.js');
    const { MobileOtpService } = await import(new URL('../dist/modules/auth/mobile-otp.service.js', import.meta.url).href) as typeof import('../src/modules/auth/mobile-otp.service.js');
    const { FakeOtpDeliveryProvider } = await import(new URL('../dist/modules/auth/fake-otp-delivery.provider.js', import.meta.url).href) as typeof import('../src/modules/auth/fake-otp-delivery.provider.js');
    const security = await import(new URL('../dist/modules/auth/auth.security.js', import.meta.url).href) as typeof import('../src/modules/auth/auth.security.js');
    type Delivery = import('../src/modules/auth/otp-delivery.provider.js').OtpDeliveryProvider;
    const key = randomBytes(32);
    const mac = new security.OtpMac(key);
    const repository = new AuthRepository(database);
    const users = new UsersRepository(database);
    const audit = new AuditRepository(new AuditService());
    // Stay within one default fixed window in rate tests, with all temporal decisions injected.
    const baseTime = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 120_000;
    let current = baseTime;
    const clock = () => new Date(current);
    const fake = new FakeOtpDeliveryProvider(1_000, clock);
    const generousRates = Object.fromEntries(Object.keys(DEFAULT_AUTH_RATE_LIMITS).map(name =>
      [name, [{ limit: 1_000, windowMs: 60_000 }]]));
    const config = (overrides: Partial<ConstructorParameters<typeof AuthConfig>[0]> = {}) => new AuthConfig({
      mode: 'test', host: '127.0.0.1', allowedOrigins: ['http://127.0.0.1:3000'], localCookie: true,
      key, clock, rateLimits: generousRates, ...overrides,
    });
    const make = (options: {
      database?: Database; repository?: InstanceType<typeof AuthRepository>;
      users?: InstanceType<typeof UsersRepository>; audit?: InstanceType<typeof AuditRepository>;
      delivery?: Delivery; config?: InstanceType<typeof AuthConfig>;
    } = {}) => new MobileOtpService(
      options.repository ?? (options.database ? new AuthRepository(options.database) : repository),
      options.users ?? (options.database ? new UsersRepository(options.database) : users),
      options.audit ?? audit, options.config ?? config(), options.delivery ?? fake,
    );
    const service = make();
    const second = make({ database: secondDatabase });
    const run = async (name: string, check: () => Promise<void>) => {
      stage = name;
      current = baseTime;
      await check();
      console.log(`PASS: ${name}.`);
    };
    const request = async (mobile = freshMobile(), instance = service, ip = freshIp()) => {
      const metadata = await instance.requestOtp({ mobile }, ip, randomUUID());
      const delivery = fake.getDelivery(metadata.challengeId);
      assert.ok(delivery);
      return { mobile, challengeId: metadata.challengeId, code: delivery.code, metadata };
    };
    const verify = (attempt: { challengeId: string; mobile: string; code: string }, instance = service, ip = freshIp(), correlationId = randomUUID()) =>
      instance.verifyOtp({ challengeId: attempt.challengeId, mobile: attempt.mobile, code: attempt.code }, ip, correlationId);
    const seedChallenge = async (mobile: string, options: { expiresAt?: Date; createdAt?: Date; failedAttempts?: number; consumedAt?: Date } = {}) => {
      const id = randomUUID();
      const code = security.generateOtpCode();
      const targetDigest = mac.targetDigest(mobile);
      await prisma.otpChallenge.create({ data: {
        id, targetDigest, codeMac: mac.codeMac({ challengeId: id, targetDigest }, code),
        createdAt: new Date(current - 61_000), expiresAt: new Date(current + 300_000), attemptLimit: 5, ...options,
      } });
      return { challengeId: id, mobile, code };
    };
    const sessionRow = (token: string) => prisma.authSession.findUniqueOrThrow({ where: { tokenDigest: security.digestSessionToken(token) } });
    const noSuccess = async (attempt: { challengeId: string; mobile: string }, correlationId: string) => {
      assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: attempt.challengeId } })).consumedAt, null);
      assert.equal(await prisma.user.count({ where: { mobile: attempt.mobile } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { correlationId } }), 0);
    };
    // Verify a real PostgreSQL lock wait, rather than relying on scheduler timing or an arbitrary sleep.
    const waitForBlocked = async (blocker: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_catalog.pg_stat_activity
          WHERE ${blocker}::integer = ANY(pg_catalog.pg_blocking_pids(pid))
        `;
        if (Number(rows[0]?.count) > 0) return;
        await delay(20);
      }
      throw new Error('The expected PostgreSQL lock wait was not observed.');
    };
    const hold = async (lock: (transaction: Prisma.TransactionClient) => Promise<unknown>, rollback = false) => {
      let release!: () => void;
      let ready!: (pid: number) => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<number>(resolve => { ready = resolve; });
      const abort = new Error('Intentional test lock-holder rollback.');
      const finished = prisma.$transaction(async transaction => {
        const [row] = await transaction.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        await lock(transaction);
        ready(row!.pid);
        await gate;
        if (rollback) throw abort;
      }, { timeout: 15_000 }).catch(error => { if (error !== abort) throw error; });
      // If setup fails, propagate it rather than hanging the test on the ready promise.
      const pid = await Promise.race([started, finished.then(() => { throw new Error('Lock holder ended before readiness.'); })]);
      return { pid, release, finished };
    };

    await run('request stores no user or session and independent resends preserve earlier challenge', async () => {
      const mobile = freshMobile();
      const first = await request(mobile);
      const original = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: first.challengeId } });
      assert.equal(await prisma.user.count({ where: { mobile } }), 0);
      current += 60_001;
      const later = await request(mobile, second);
      assert.notEqual(first.challengeId, later.challengeId);
      assert.deepEqual(await prisma.otpChallenge.findUniqueOrThrow({ where: { id: first.challengeId } }), original);
      assert.notEqual(original.codeMac, first.code);
      assert.notEqual(original.targetDigest, mobile);
      const login = await verify(first);
      assert.equal(login.user.mobile, mobile);
      for (const field of ['email', 'firstName', 'lastName', 'birthDate', 'displayName', 'avatar'] as const) assert.equal(login.user[field], null);
      assert.equal(await prisma.userRole.count({ where: { userId: login.user.id } }), 0);
      assert.equal((await sessionRow(login.token)).authenticationMethod, 'MOBILE_OTP');
      assert.ok(!JSON.stringify(login).includes(login.token));
      assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: later.challengeId } })).consumedAt, null);
    });

    await run('one challenged proof has one winner and exactly one issued session under contention', async () => {
      const attempt = await request();
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => verify(attempt, index % 2 ? service : second)));
      const winners = results.filter(result => result.status === 'fulfilled');
      assert.equal(winners.length, 1);
      for (const result of results) if (result.status === 'rejected') assert.ok(hasCode('AUTH_OTP_CONSUMED')(result.reason));
      const user = await prisma.user.findUniqueOrThrow({ where: { mobile: attempt.mobile } });
      assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: 'auth.otp.consumed', entityId: attempt.challengeId } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: 'auth.user.created', entityId: user.id } }), 1);
    });

    await run('unknown and mismatched targets hide challenge state without exhausting another target', async () => {
      const attempt = await request();
      const before = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: attempt.challengeId } });
      await assert.rejects(verify({ ...attempt, mobile: freshMobile() }), hasCode('AUTH_OTP_INVALID'));
      await assert.rejects(verify({ ...attempt, challengeId: randomUUID() }), hasCode('AUTH_OTP_INVALID'));
      assert.deepEqual(await prisma.otpChallenge.findUniqueOrThrow({ where: { id: attempt.challengeId } }), before);
      current += 300_001;
      await assert.rejects(verify({ ...attempt, mobile: freshMobile() }), hasCode('AUTH_OTP_INVALID'));
      await assert.rejects(verify(attempt), hasCode('AUTH_OTP_EXPIRED'));
      assert.equal(await prisma.user.count({ where: { mobile: attempt.mobile } }), 0);
    });

    await run('wrong OTP errors commit failures and concurrent attempts saturate without consumption', async () => {
      const attempt = await request();
      const wrong = { ...attempt, code: attempt.code === '000000' ? '111111' : '000000' };
      await assert.rejects(verify(wrong), hasCode('AUTH_OTP_INVALID'));
      assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: attempt.challengeId } })).failedAttempts, 1);
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => verify(wrong, index % 2 ? service : second)));
      for (const result of results) {
        assert.equal(result.status, 'rejected');
        if (result.status === 'rejected') assert.ok(hasCode('AUTH_OTP_INVALID', 'AUTH_OTP_EXHAUSTED')(result.reason));
      }
      const row = await prisma.otpChallenge.findUniqueOrThrow({ where: { id: attempt.challengeId } });
      assert.equal(row.failedAttempts, row.attemptLimit);
      assert.equal(row.consumedAt, null);
      await assert.rejects(verify(attempt), hasCode('AUTH_OTP_EXHAUSTED'));
      assert.equal(await prisma.user.count({ where: { mobile: attempt.mobile } }), 0);
      assert.ok(await prisma.auditLog.count({ where: { action: 'auth.otp.failed', entityId: attempt.challengeId } }) >= 5);
    });

    await run('distinct proofs converge on one user and retain independent session families', async () => {
      const mobile = freshMobile();
      const attempts = await Promise.all(Array.from({ length: 4 }, () => seedChallenge(mobile)));
      const results = await Promise.all(attempts.map((attempt, index) => verify(attempt, index % 2 ? service : second)));
      assert.equal(new Set(results.map(result => result.user.id)).size, 1);
      assert.equal(await prisma.user.count({ where: { mobile } }), 1);
      const sessions = await prisma.authSession.findMany({ where: { userId: results[0]!.user.id } });
      assert.equal(sessions.length, attempts.length);
      assert.ok(sessions.every(row => !row.rotatedFromId && !row.revokedAt && row.authenticationMethod === 'MOBILE_OTP'));
      await service.logout(results[0]!.token, freshIp(), randomUUID());
      await assert.rejects(service.currentSession(results[0]!.token, freshIp()), hasCode('AUTH_SESSION_INVALID'));
      for (const result of results.slice(1)) assert.equal((await second.currentSession(result.token, freshIp())).user.id, result.user.id);
    });

    await run('expiry after challenge row-lock wait prevents authentication', async () => {
      const attempt = await request();
      const blocker = await hold(transaction => transaction.$queryRaw`SELECT id FROM "OtpChallenge" WHERE id = ${attempt.challengeId}::uuid FOR UPDATE`);
      const pending = verify(attempt);
      const rejected = assert.rejects(pending, hasCode('AUTH_OTP_EXPIRED'));
      try { await waitForBlocked(blocker.pid); current += 300_001; }
      finally { blocker.release(); await blocker.finished; }
      await rejected;
      assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: attempt.challengeId } })).consumedAt, null);
      assert.equal(await prisma.user.count({ where: { mobile: attempt.mobile } }), 0);
    });

    await run('expiry after unique-mobile wait rolls back tentative user, consumption, session and audits', async () => {
      const attempt = await request();
      const correlationId = randomUUID();
      const blocker = await hold(transaction => transaction.user.create({ data: { mobile: attempt.mobile } }), true);
      const pending = verify(attempt, service, freshIp(), correlationId);
      const rejected = assert.rejects(pending, hasCode('AUTH_OTP_EXPIRED'));
      try { await waitForBlocked(blocker.pid); current += 300_001; }
      finally { blocker.release(); await blocker.finished; }
      await rejected;
      await noSuccess(attempt, correlationId);
    });

    await run('target cooldown is atomic across instances without replacing any challenge', async () => {
      const mobile = freshMobile();
      const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => request(mobile, index % 2 ? service : second)));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      for (const result of results) if (result.status === 'rejected') assert.ok(hasCode('AUTH_THROTTLED')(result.reason));
      assert.equal(await prisma.otpChallenge.count({ where: { targetDigest: mac.targetDigest(mobile) } }), 1);
      assert.equal(await prisma.user.count({ where: { mobile } }), 0);
    });

    await run('active-challenge cap races admit one final slot and never evict earlier challenges', async () => {
      const mobile = freshMobile();
      const earlier = await Promise.all(Array.from({ length: 4 }, () => seedChallenge(mobile)));
      const original = await prisma.otpChallenge.findMany({ where: { targetDigest: mac.targetDigest(mobile) }, orderBy: { id: 'asc' } });
      const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => request(mobile, index % 2 ? service : second)));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(await prisma.otpChallenge.count({ where: { targetDigest: mac.targetDigest(mobile) } }), 5);
      assert.deepEqual(await prisma.otpChallenge.findMany({ where: { id: { in: earlier.map(item => item.challengeId) } }, orderBy: { id: 'asc' } }), original);
      current += 60_001;
      await assert.rejects(request(mobile), hasCode('AUTH_THROTTLED'));
      await verify(earlier[0]!);
    });

    await run('user, session and audit failures roll back all successful proof effects', async () => {
      class FailingUsers extends UsersRepository {
        override async findOrCreateMobile(...args: Parameters<InstanceType<typeof UsersRepository>['findOrCreateMobile']>): Promise<never> {
          await super.findOrCreateMobile(...args);
          throw new Error('Intentional user persistence failure.');
        }
      }
      class FailingSession extends AuthRepository {
        override async issueMobileSession(...args: Parameters<InstanceType<typeof AuthRepository>['issueMobileSession']>): Promise<never> {
          await super.issueMobileSession(...args);
          throw new Error('Intentional session persistence failure.');
        }
      }
      class FailingAudit extends AuditRepository {
        override async append(...args: Parameters<InstanceType<typeof AuditRepository>['append']>): Promise<void> {
          await super.append(...args);
          if (args[1].action === 'auth.session.issued') throw new Error('Intentional audit persistence failure.');
        }
      }
      for (const instance of [
        make({ users: new FailingUsers(database) }), make({ repository: new FailingSession(database) }),
        make({ audit: new FailingAudit(new AuditService()) }),
      ]) {
        const attempt = await request();
        const correlationId = randomUUID();
        await assert.rejects(verify(attempt, instance, freshIp(), correlationId), hasCode('AUTH_UNAVAILABLE'));
        await noSuccess(attempt, correlationId);
      }
    });

    await run('provider rejection and timeout roll back challenge and audit without refunding admission', async () => {
      for (const timeout of [false, true]) {
        const mobile = freshMobile();
        const correlationId = randomUUID();
        let calls = 0;
        const delivery: Delivery = { deliver: async () => {
          calls += 1;
          if (timeout) await new Promise<void>(() => {});
          throw new Error('Intentional provider rejection.');
        } };
        const instance = make({ delivery, config: config({ deliveryTimeoutMs: 25, rateLimits: DEFAULT_AUTH_RATE_LIMITS }) });
        await assert.rejects(instance.requestOtp({ mobile }, freshIp(), correlationId), hasCode('AUTH_DELIVERY_UNAVAILABLE'));
        assert.equal(calls, 1);
        assert.equal(await prisma.otpChallenge.count({ where: { targetDigest: mac.targetDigest(mobile) } }), 0);
        assert.equal(await prisma.auditLog.count({ where: { correlationId } }), 0);
        assert.equal(await prisma.user.count({ where: { mobile } }), 0);
        // Two further failed deliveries consume the remaining target window budget. No retry is automatic.
        await assert.rejects(instance.requestOtp({ mobile }, freshIp()), hasCode('AUTH_DELIVERY_UNAVAILABLE'));
        await assert.rejects(instance.requestOtp({ mobile }, freshIp()), hasCode('AUTH_DELIVERY_UNAVAILABLE'));
        await assert.rejects(instance.requestOtp({ mobile }, freshIp()), hasCode('AUTH_THROTTLED'));
        assert.equal(calls, 3);
      }
    });

    await run('PostgreSQL COMMIT rejection after delivery leaves only an unusable orphan code', async () => {
      const injected = interceptTransactions(database, async (transaction, work) => {
        const result = await work(transaction);
        // Deferred validation fires at COMMIT, after the callback and delivery completed. The temporary
        // objects roll back with the failed transaction and never alter the public schema/migrations.
        await transaction.$executeRaw`CREATE TEMP TABLE auth02_commit_parent (id integer PRIMARY KEY) ON COMMIT DROP`;
        await transaction.$executeRaw`CREATE TEMP TABLE auth02_commit_child (parent_id integer REFERENCES auth02_commit_parent(id) DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP`;
        await transaction.$executeRaw`INSERT INTO auth02_commit_child (parent_id) VALUES (1)`;
        return result;
      });
      const mobile = freshMobile();
      const correlationId = randomUUID();
      let delivered: { challengeId: string; code: string } | undefined;
      let deliveries = 0;
      const delivery: Delivery = { deliver: async input => {
        deliveries += 1;
        await fake.deliver(input);
        delivered = { challengeId: input.challengeId, code: input.code };
      } };
      await assert.rejects(make({ database: injected, delivery }).requestOtp({ mobile }, freshIp(), correlationId), hasCode('AUTH_UNAVAILABLE'));
      assert.equal(deliveries, 1);
      assert.ok(delivered);
      assert.equal(await prisma.otpChallenge.count({ where: { targetDigest: mac.targetDigest(mobile) } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { correlationId } }), 0);
      await assert.rejects(verify({ ...delivered, mobile }), hasCode('AUTH_OTP_INVALID'));
      assert.equal(await prisma.user.count({ where: { mobile } }), 0);
      // The same real COMMIT failure must roll back successful proof and all post-proof persistence.
      const attempt = await request();
      const proofCorrelation = randomUUID();
      await assert.rejects(verify(attempt, make({ database: injected }), freshIp(), proofCorrelation), hasCode('AUTH_UNAVAILABLE'));
      await noSuccess(attempt, proofCorrelation);
    });

    await run('shared admission limits across independent instances never over-admit', async () => {
      const mobile = freshMobile();
      const bucket = { bucketKey: mac.rateLimitDigest('auth02-shared-test', mobile), scope: 'otp-verification' as const,
        windowStart: new Date(current - 1_000), expiresAt: new Date(current + 60_000), limit: 7 };
      const otherRepository = new AuthRepository(secondDatabase);
      const results = await Promise.all(Array.from({ length: 30 }, (_, index) =>
        (index % 2 ? repository : otherRepository).useRateLimit(bucket, clock)));
      assert.equal(results.filter(Boolean).length, 7);
      const stored = await prisma.authRateLimitBucket.findUniqueOrThrow({ where: { bucketKey_scope_windowStart: {
        bucketKey: bucket.bucketKey, scope: bucket.scope, windowStart: bucket.windowStart,
      } } });
      assert.equal(stored.count, 7);
      // Exact target cooldown does not substitute for the independently shared 3/15-minute limit.
      const target = freshMobile();
      const defaultFirst = make({ config: config({ rateLimits: DEFAULT_AUTH_RATE_LIMITS }) });
      const defaultSecond = make({ database: secondDatabase, config: config({ rateLimits: DEFAULT_AUTH_RATE_LIMITS }) });
      for (const instance of [defaultFirst, defaultSecond, defaultFirst]) { await request(target, instance); current += 60_001; }
      await assert.rejects(request(target, defaultSecond), hasCode('AUTH_THROTTLED'));
      assert.equal(await prisma.otpChallenge.count({ where: { targetDigest: mac.targetDigest(target) } }), 3);
      assert.match(stored.bucketKey, /^[a-f0-9]{64}$/);
      assert.ok(!JSON.stringify(stored).includes(mobile));
    });

    await run('rotation budget follows the stable family across replacement bearers and leaves logout available', async () => {
      const login = await verify(await request());
      const first = make({ config: config({ rateLimits: DEFAULT_AUTH_RATE_LIMITS }) });
      const other = make({ database: secondDatabase, config: config({ rateLimits: DEFAULT_AUTH_RATE_LIMITS }) });
      let token = login.token;
      for (let index = 0; index < 6; index += 1) {
        const next = await (index % 2 ? first : other).rotateSession(token, freshIp());
        assert.equal(next.expiresAt.getTime(), login.expiresAt.getTime());
        token = next.token;
      }
      await assert.rejects(other.rotateSession(token, freshIp()), hasCode('AUTH_THROTTLED'));
      assert.equal(await prisma.authSession.count({ where: { userId: login.user.id } }), 7);
      assert.equal((await first.currentSession(token, freshIp())).user.id, login.user.id);
      await other.logout(login.token, freshIp());
      await assert.rejects(first.currentSession(token, freshIp()), hasCode('AUTH_SESSION_INVALID'));
    });

    await run('rotation and logout audit or COMMIT failures preserve the previously valid family', async () => {
      for (const failAtCommit of [false, true]) {
        const injected = interceptTransactions(database, async (transaction, work) => {
          const proxied = new Proxy(transaction, { get(target, name) {
            if (name === 'auditLog' && !failAtCommit) return new Proxy(target.auditLog, { get(model, method) {
              if (method === 'create') return async (...args: Parameters<typeof model.create>) => {
                await model.create(...args);
                throw new Error('Intentional session audit failure.');
              };
              const value: unknown = Reflect.get(model, method, model);
              return typeof value === 'function' ? value.bind(model) : value;
            } });
            const value: unknown = Reflect.get(target, name, target);
            return typeof value === 'function' ? value.bind(target) : value;
          } });
          const result = await work(proxied);
          if (failAtCommit) {
            await transaction.$executeRaw`CREATE TEMP TABLE auth02_session_commit (id integer UNIQUE DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP`;
            await transaction.$executeRaw`INSERT INTO auth02_session_commit (id) VALUES (1), (1)`;
          }
          return result;
        });
        const instance = make({ database: injected });
        const login = await verify(await request());
        const row = await sessionRow(login.token);
        for (const operation of [
          () => instance.rotateSession(login.token, freshIp(), randomUUID()),
          () => instance.logout(login.token, freshIp(), randomUUID()),
        ]) {
          await assert.rejects(operation(), hasCode('AUTH_UNAVAILABLE'));
          assert.equal((await service.currentSession(login.token, freshIp())).user.id, login.user.id);
          assert.equal((await sessionRow(login.token)).revokedAt, null);
          assert.equal(await prisma.authSession.count({ where: { rotatedFromId: row.id } }), 0);
          assert.equal(await prisma.auditLog.count({ where: { entityId: row.id, action: { in: ['auth.session.rotated', 'auth.session.revoked'] } } }), 0);
        }
      }
    });

    await run('parallel rotation issues one successor with unchanged expiry and assurance', async () => {
      const login = await verify(await request());
      const original = await sessionRow(login.token);
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
        (index % 2 ? service : second).rotateSession(login.token, freshIp(), randomUUID())));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      for (const result of results) if (result.status === 'rejected') assert.ok(hasCode('AUTH_SESSION_INVALID')(result.reason));
      const successors = await prisma.authSession.findMany({ where: { rotatedFromId: original.id } });
      assert.equal(successors.length, 1);
      assert.equal(successors[0]!.expiresAt.getTime(), original.expiresAt.getTime());
      assert.equal(successors[0]!.authenticationMethod, 'MOBILE_OTP');
      assert.ok((await sessionRow(login.token)).revokedAt);
      await assert.rejects(service.currentSession(login.token, freshIp()), hasCode('AUTH_SESSION_INVALID'));
    });

    for (const first of ['rotate', 'logout'] as const) await run(`${first}-first root-lock race and stale ancestor logout cannot resurrect a family`, async () => {
      const login = await verify(await request());
      const original = await sessionRow(login.token);
      const independent = await verify(await seedChallenge(login.user.mobile));
      let reached!: () => void;
      let release!: () => void;
      const blocked = new Promise<void>(resolve => { reached = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      let firstPid = 0;
      let intercepted = false;
      const pausing = interceptTransactions(database, async (transaction, work) => {
        const result = await work(transaction);
        if (!intercepted) {
          intercepted = true;
          const [row] = await transaction.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          firstPid = row!.pid;
          reached();
          await gate;
        }
        return result;
      });
      const leading = make({ database: pausing });
      const firstOperation = first === 'rotate' ? leading.rotateSession(login.token, freshIp(), randomUUID()) : leading.logout(login.token, freshIp(), randomUUID());
      await Promise.race([blocked, firstOperation.then(() => { throw new Error('Expected root lock was not held.'); })]);
      const laterOperation = first === 'rotate' ? second.logout(login.token, freshIp(), randomUUID()) : second.rotateSession(login.token, freshIp(), randomUUID());
      const laterSettled = Promise.allSettled([laterOperation]);
      try { await waitForBlocked(firstPid); }
      finally { release(); }
      const result = await firstOperation;
      const [later] = await laterSettled;
      assert.ok(later);
      if (first === 'rotate') {
        assert.equal(later.status, 'fulfilled');
        assert.ok(result && 'token' in result);
        // Models a late successful rotate response installing its cookie after logout's response.
        await assert.rejects(second.currentSession(result.token, freshIp()), hasCode('AUTH_SESSION_INVALID'));
      } else {
        assert.equal(later.status, 'rejected');
        if (later.status === 'rejected') assert.ok(hasCode('AUTH_SESSION_INVALID')(later.reason));
      }
      const rows = await prisma.authSession.findMany({ where: { OR: [{ id: original.id }, { rotatedFromId: original.id }] } });
      assert.ok(rows.every(row => row.revokedAt !== null));
      await service.logout(login.token, freshIp(), randomUUID());
      assert.equal((await second.currentSession(independent.token, freshIp())).user.id, login.user.id);
    });

    await run('multi-generation stale ancestors revoke descendants but not independent logins', async () => {
      const login = await verify(await request());
      const first = await service.rotateSession(login.token, freshIp());
      const secondRotation = await second.rotateSession(first.token, freshIp());
      const third = await service.rotateSession(secondRotation.token, freshIp());
      const other = await verify(await seedChallenge(login.user.mobile));
      await service.logout(login.token, freshIp());
      for (const token of [login.token, first.token, secondRotation.token, third.token]) {
        await assert.rejects(second.currentSession(token, freshIp()), hasCode('AUTH_SESSION_INVALID'));
        await assert.rejects(second.rotateSession(token, freshIp()), hasCode('AUTH_SESSION_INVALID'));
      }
      assert.equal((await service.currentSession(other.token, freshIp())).user.id, login.user.id);
    });

    await run('expired and revoked sessions never resurrect and rate failures fail closed', async () => {
      const login = await verify(await request());
      const row = await sessionRow(login.token);
      current = row.expiresAt.getTime() + 1;
      await assert.rejects(service.currentSession(login.token, freshIp()), hasCode('AUTH_SESSION_EXPIRED'));
      await assert.rejects(service.rotateSession(login.token, freshIp()), hasCode('AUTH_SESSION_EXPIRED'));
      assert.equal(await prisma.authSession.count({ where: { rotatedFromId: row.id } }), 0);
      current = baseTime;
      const revoked = await verify(await request());
      await service.logout(revoked.token, freshIp());
      await assert.rejects(second.rotateSession(revoked.token, freshIp()), hasCode('AUTH_SESSION_INVALID'));
      class FailingRate extends AuthRepository {
        override async useRateLimit(): Promise<boolean> { throw new Error('Intentional limiter failure.'); }
      }
      const mobile = freshMobile();
      await assert.rejects(make({ repository: new FailingRate(database) }).requestOtp({ mobile }, freshIp()), hasCode('AUTH_UNAVAILABLE'));
      assert.equal(await prisma.otpChallenge.count({ where: { targetDigest: mac.targetDigest(mobile) } }), 0);
    });

    await run('real loopback HTTP controller-to-PostgreSQL and Fake delivery complete all five endpoints', async () => {
      const { NestFactory } = await import('@nestjs/core');
      const { AppModule } = await import(new URL('../dist/app.module.js', import.meta.url).href) as typeof import('../src/app.module.js');
      const { configureAuthHttp } = await import(new URL('../dist/modules/auth/auth.http.js', import.meta.url).href) as typeof import('../src/modules/auth/auth.http.js');
      const { OtpDeliveryProvider } = await import(new URL('../dist/modules/auth/otp-delivery.provider.js', import.meta.url).href) as typeof import('../src/modules/auth/otp-delivery.provider.js');
      const environment = {
        NODE_ENV: 'test', HOST: '127.0.0.1', AUTH_MODE: 'test', AUTH_COOKIE_MODE: 'local',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:3000', AUTH_OTP_COOLDOWN_MS: '0',
        AUTH_OTP_LIFETIME_MS: '300000', AUTH_OTP_ATTEMPT_LIMIT: '5', AUTH_OTP_MAX_ACTIVE_CHALLENGES: '5',
        AUTH_SESSION_LIFETIME_MS: '43200000', AUTH_DELIVERY_TIMEOUT_MS: '2000',
        AUTH_RATE_LIMITS: JSON.stringify(generousRates),
      };
      const previous = new Map(Object.keys(environment).map(name => [name, process.env[name]]));
      Object.assign(process.env, environment);
      let app: import('@nestjs/platform-express').NestExpressApplication | undefined;
      try {
        // Production module graph, decorators, guards, DTO pipe, errors, service, repositories and
        // provider binding. Only explicit local/test configuration differs from bootstrap.
        app = await NestFactory.create<import('@nestjs/platform-express').NestExpressApplication>(AppModule,
          { logger: false, bodyParser: false, abortOnError: false });
        const httpConfig = app.get(AuthConfig);
        const delivery = app.get(OtpDeliveryProvider);
        assert.ok(delivery instanceof FakeOtpDeliveryProvider);
        configureAuthHttp(app, httpConfig);
        await app.listen(0, '127.0.0.1');
        const base = await app.getUrl();
        const headers = { origin: environment.AUTH_ALLOWED_ORIGINS, 'x-rahrow-auth': '1', 'content-type': 'application/json' };
        const send = (path: string, init: RequestInit = {}) => fetch(`${base}/api/v1/auth/${path}`, {
          ...init, signal: AbortSignal.timeout(10_000),
        });
        const post = (path: string, body: unknown, cookie?: string) => send(path, {
          method: 'POST', headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
        });
        const cookieFrom = (response: Response): string => {
          const value = response.headers.get('set-cookie');
          assert.ok(value);
          assert.ok(value.startsWith(`${httpConfig.cookieName}=`));
          for (const flag of ['HttpOnly', 'SameSite=Lax', 'Path=/']) assert.ok(value.includes(flag));
          assert.doesNotMatch(value, /Domain=|Secure/i);
          return value.split(';')[0]!;
        };
        const responseError = async (response: Response, status: number, code: string) => {
          assert.equal(response.status, status);
          assert.equal(response.headers.get('cache-control'), 'private, no-store');
          assert.equal(response.headers.get('set-cookie'), null);
          const body = await response.json() as { error: { code: string; correlationId: string } };
          assert.equal(body.error.code, code);
          assert.match(body.error.correlationId, /^[0-9a-f-]{36}$/);
        };
        const mobile = freshMobile();
        const requested = await post('otp/request', { mobile });
        assert.equal(requested.status, 202);
        assert.equal(requested.headers.get('set-cookie'), null);
        assert.equal(requested.headers.get('cache-control'), 'private, no-store');
        assert.equal(requested.headers.get('access-control-allow-origin'), environment.AUTH_ALLOWED_ORIGINS);
        assert.equal(requested.headers.get('access-control-allow-credentials'), 'true');
        const metadata = await requested.json() as { challengeId: string; expiresAt: string; retryAfterSeconds: number };
        assert.deepEqual(Object.keys(metadata).sort(), ['challengeId', 'expiresAt', 'retryAfterSeconds']);
        assert.equal(await prisma.user.count({ where: { mobile } }), 0);
        const sent = delivery.getDelivery(metadata.challengeId);
        assert.ok(sent);
        const wrong = sent.code === '000000' ? '111111' : '000000';
        await responseError(await post('otp/verify', { mobile, challengeId: metadata.challengeId, code: wrong }), 401, 'AUTH_OTP_INVALID');
        assert.equal((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: metadata.challengeId } })).failedAttempts, 1);
        const verified = await Promise.all(Array.from({ length: 2 }, () => post('otp/verify', {
          mobile, challengeId: metadata.challengeId, code: sent.code,
        })));
        const winner = verified.find(response => response.status === 200);
        assert.ok(winner);
        assert.equal(verified.filter(response => response.status === 200).length, 1);
        await responseError(verified.find(response => response !== winner)!, 401, 'AUTH_OTP_CONSUMED');
        const firstCookie = cookieFrom(winner);
        const result = await winner.json() as { user: { id: string; mobile: string }; session: { expiresAt: string } };
        assert.deepEqual(Object.keys(result).sort(), ['session', 'user']);
        assert.deepEqual(Object.keys(result.user).sort(), ['avatar', 'birthDate', 'displayName', 'email', 'firstName', 'id', 'lastName', 'mobile']);
        assert.equal(result.user.mobile, mobile);
        assert.ok(!JSON.stringify(result).includes(firstCookie.split('=')[1]!));
        assert.equal(await prisma.authSession.count({ where: { userId: result.user.id } }), 1);
        assert.equal(await prisma.userRole.count({ where: { userId: result.user.id } }), 0);
        assert.ok((await prisma.otpChallenge.findUniqueOrThrow({ where: { id: metadata.challengeId } })).consumedAt);
        const firstSession = await prisma.authSession.findFirstOrThrow({ where: { userId: result.user.id } });
        const self = await send('session', { headers: { 'x-rahrow-auth': '1', cookie: firstCookie } });
        assert.equal(self.status, 200);
        assert.equal(self.headers.get('set-cookie'), null);
        assert.deepEqual(await self.json(), result);
        assert.deepEqual(await prisma.authSession.findUniqueOrThrow({ where: { id: firstSession.id } }), firstSession);
        const secondRequested = await post('otp/request', { mobile });
        assert.equal(secondRequested.status, 202);
        const secondMetadata = await secondRequested.json() as { challengeId: string };
        const secondDelivery = delivery.getDelivery(secondMetadata.challengeId);
        assert.ok(secondDelivery);
        const independent = await post('otp/verify', { mobile, challengeId: secondMetadata.challengeId, code: secondDelivery.code });
        assert.equal(independent.status, 200);
        const independentCookie = cookieFrom(independent);
        assert.equal((await independent.json() as { user: { id: string } }).user.id, result.user.id);
        assert.equal(await prisma.user.count({ where: { mobile } }), 1);
        assert.equal(await prisma.authSession.count({ where: { userId: result.user.id, rotatedFromId: null } }), 2);
        const rotated = await post('session/rotate', {}, firstCookie);
        assert.equal(rotated.status, 200);
        const rotatedCookie = cookieFrom(rotated);
        assert.notEqual(rotatedCookie, firstCookie);
        assert.deepEqual(await rotated.json(), { session: result.session });
        await responseError(await post('session/rotate', {}, firstCookie), 401, 'AUTH_SESSION_INVALID');
        await responseError(await send('session', { headers: { 'x-rahrow-auth': '1', cookie: firstCookie } }), 401, 'AUTH_SESSION_INVALID');
        const logout = await post('logout', {}, firstCookie);
        assert.equal(logout.status, 204);
        assert.equal(await logout.text(), '');
        assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
        await responseError(await send('session', { headers: { 'x-rahrow-auth': '1', cookie: rotatedCookie } }), 401, 'AUTH_SESSION_INVALID');
        const otherSelf = await send('session', { headers: { 'x-rahrow-auth': '1', cookie: independentCookie } });
        assert.equal(otherSelf.status, 200);
        assert.equal((await otherSelf.json() as { user: { id: string } }).user.id, result.user.id);
        assert.equal((await post('logout', {})).status, 204);
        assert.equal(await prisma.auditLog.count({ where: { action: 'auth.user.created', entityId: result.user.id } }), 1);
        assert.equal(await prisma.auditLog.count({ where: { action: 'auth.session.issued', actorId: result.user.id } }), 2);
      } finally {
        try { await app?.close(); }
        finally {
          for (const [name, value] of previous) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
          }
        }
      }
    });

    stage = 'secret-free AUTH-02 restart checkpoint';
    if (snapshotPath) {
      const snapshot = await persistedState(prisma);
      assert.ok(!/"(?:token|tokenDigest|code|codeMac|targetDigest|mobile|passwordHash|totpCiphertext|key)"\s*:/.test(snapshot));
      await writeFile(snapshotPath, snapshot, { flag: 'wx', mode: 0o600 });
    }
    key.fill(0);
    console.log('PASS: Real AUTH-02 PostgreSQL orchestration, rollback, concurrency and lifecycle acceptance; fixtures remain only in the owned disposable QA volume.');
  } finally {
    await Promise.all([database.onModuleDestroy(), secondDatabase.onModuleDestroy()]);
  }
}

try {
  await checkAuthFlowDatabase();
} catch {
  // Never expose a failed assertion's values, SQL/provider errors, account data or credentials.
  console.error(`FAIL: AUTH-02 database verification failed at ${stage}. Scoped CI cleanup must still run.`);
  process.exitCode = 1;
}
