import { test as base, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export interface AuthHarness {
  mode: 'database' | 'contract';
  codeFor(challengeId: string): string;
  advance(milliseconds: number): void;
  failNext(operation: 'requestOtp' | 'verifyOtp' | 'currentSession' | 'rotateSession' | 'logout',
    code?: 'AUTH_UNAVAILABLE' | 'AUTH_DELIVERY_UNAVAILABLE' | 'AUTH_THROTTLED'): void;
  close(): Promise<void>;
}

export const test = base.extend<{ auth: AuthHarness }>({
  auth: async ({}, runFixture) => {
    // Each test owns a fresh key and Fake instance. DB rows remain for canonical scoped cleanup.
    const path = pathToFileURL(resolve(process.cwd(), 'apps/api/scripts/auth-web-test-harness.mjs')).href;
    const { startAuthBrowserHarness } = await import(path) as {
      startAuthBrowserHarness(options: { mode: string; origin: string; port: number }): Promise<AuthHarness>;
    };
    const auth = await startAuthBrowserHarness({ mode: process.env.RAHROW_WEB_E2E_MODE ?? 'database',
      origin: 'http://127.0.0.1:3100', port: 3101 });
    try { await runFixture(auth); } finally { await auth.close(); }
  },
});
export { expect };
