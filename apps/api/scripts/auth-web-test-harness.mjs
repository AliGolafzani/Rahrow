import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuthHttpError } from '../dist/modules/auth/auth.errors.js';
import { AuthConfig } from '../dist/modules/auth/auth.config.js';
import { AuthController } from '../dist/modules/auth/auth.controller.js';
import { AuthHttpGuard, configureAuthHttp } from '../dist/modules/auth/auth.http.js';
import { TrustedSessionResolver } from '../dist/modules/auth/auth.guard.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { MobileOtpService } from '../dist/modules/auth/mobile-otp.service.js';
import { FakeOtpDeliveryProvider } from '../dist/modules/auth/fake-otp-delivery.provider.js';
import { AuthRepository } from '../dist/modules/auth/auth.repository.js';
import { UsersRepository } from '../dist/modules/users/users.repository.js';
import { AuditRepository } from '../dist/modules/audit/audit.repository.js';
import { AuditService } from '../dist/modules/audit/audit.service.js';
import { assertDisposableAuthTestEnvironment } from './auth-schema.ts';
import { getLocalDatabaseUrl, loadLocalEnvironment } from './local-database.ts';
import { createContractStore } from './auth-web-contract-store.mjs';

/**
 * Test-process-owned Nest fixture. There is deliberately no control/reveal HTTP route,
 * file, log, environment code, or application switch for retrieving deliveries.
 * Every code comes directly from this exact Fake instance's getDelivery(challengeId).
 */
export async function startAuthBrowserHarness({ mode, origin, port }) {
  assert.ok(mode === 'database' || mode === 'contract', 'Explicit browser fixture mode is required.');
  assert.equal(new globalThis.URL(origin).hostname, '127.0.0.1');
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  let database;
  let app;
  try {
    let dependencies;
    if (mode === 'database') {
      // Identical opt-in/namespace/local URL guard to the existing AUTH-01/02 live runners.
      // The workflow supplies this only after ownership proof and persisted restart comparison.
      assertDisposableAuthTestEnvironment(process.env);
      loadLocalEnvironment();
      getLocalDatabaseUrl();
      const { PrismaService } = await import('../dist/database/prisma.service.js');
      database = new PrismaService();
      const [identity] = await database.client.$queryRaw`
        SELECT current_database() AS database, current_user AS username
      `;
      assert.equal(identity?.database, process.env.POSTGRES_DB);
      assert.equal(identity?.username, process.env.POSTGRES_USER);
      dependencies = { repository: new AuthRepository(database), users: new UsersRepository(database), audit: new AuditRepository(new AuditService()) };
    } else {
      dependencies = createContractStore();
    }
    // Start at wall time so browser expiry display and backend timestamps agree.
    // Only explicit test advancement simulates elapsed cooldown/expiry.
    let offset = 0;
    const clock = () => new Date(Date.now() + offset);
    const configuration = new AuthConfig({ mode: 'test', nodeEnv: 'test', host: '127.0.0.1',
      allowedOrigins: [origin], localCookie: true, key: randomBytes(32), clock });
    const delivery = new FakeOtpDeliveryProvider(1000, clock);
    const service = new MobileOtpService(dependencies.repository, dependencies.users, dependencies.audit, configuration, delivery);
    // Failure injection stays inside this test process; ordinary operations call the real service.
    const failures = new Map();
    for (const name of ['requestOtp', 'verifyOtp', 'currentSession', 'rotateSession', 'logout']) {
      const original = service[name].bind(service);
      service[name] = async (...args) => {
        const code = failures.get(name);
        if (code) { failures.delete(name); throw new AuthHttpError(code, code === 'AUTH_THROTTLED' ? 2 : undefined); }
        return original(...args);
      };
    }
    const resolver = new TrustedSessionResolver(new AuthService(dependencies.repository), configuration);
    class BrowserAcceptanceModule {}
    Module({ controllers: [AuthController], providers: [
      { provide: AuthConfig, useValue: configuration },
      { provide: MobileOtpService, useValue: service },
      { provide: TrustedSessionResolver, useValue: resolver }, AuthHttpGuard,
    ] })(BrowserAcceptanceModule);
    app = await NestFactory.create(BrowserAcceptanceModule, { bodyParser: false, logger: false, abortOnError: false });
    // This per-test server is recreated on one fixed loopback port. Do not let the
    // separately running Next process reuse a socket belonging to the previous fixture.
    app.use((_request, response, next) => { response.setHeader('Connection', 'close'); next(); });
    configureAuthHttp(app, configuration);
    await app.listen(port, '127.0.0.1');
    return {
      mode,
      /** Only the caller already owning this process may retrieve a delivery. Never serialize it. */
      codeFor(challengeId) {
        const record = delivery.getDelivery(challengeId);
        if (!record) throw new Error('Expected in-process test delivery is unavailable.');
        return record.code;
      },
      failNext(operation, code = 'AUTH_UNAVAILABLE') {
        assert.ok(['requestOtp', 'verifyOtp', 'currentSession', 'rotateSession', 'logout'].includes(operation));
        assert.ok(['AUTH_UNAVAILABLE', 'AUTH_DELIVERY_UNAVAILABLE', 'AUTH_THROTTLED'].includes(code));
        failures.set(operation, code);
      },
      advance(milliseconds) {
        assert.ok(Number.isSafeInteger(milliseconds) && milliseconds >= 0);
        offset += milliseconds;
      },
      async close() { await app.close(); if (database) await database.onModuleDestroy(); },
    };
  } catch {
    if (app) await app.close().catch(() => {});
    if (database) await database.onModuleDestroy().catch(() => {});
    // Underlying DB/HTTP diagnostics could include PII or connection credentials.
    throw new Error('Browser auth fixture failed its isolated test setup; no private diagnostics retained.');
  }
}
