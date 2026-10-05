import { defineConfig } from '@playwright/test';
import process from 'node:process';

// Pinned Playwright would otherwise write an automatic error-context page snapshot.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
if (process.env.DEBUG || process.env.PWDEBUG) throw new Error('Auth browser tests require debug logging disabled.');

const mode = process.env.RAHROW_WEB_E2E_MODE ?? 'database';
if (!['database', 'contract'].includes(mode)) throw new Error('Unknown browser acceptance mode.');
if (mode === 'contract' && process.env.CI === 'true') throw new Error('Contract-only browser runs cannot substitute for the database CI gate.');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  forbidOnly: true,
  reporter: [['./e2e/sanitized-reporter.ts']],
  outputDir: '../../.auth-browser-results',
  preserveOutput: 'never',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    // Codes, cookies, private account data and request bodies must never enter artifacts.
    screenshot: 'off', video: 'off', trace: 'off',
    launchOptions: process.env.RAHROW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.RAHROW_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: 'npm run start --workspace @rahrow/web -- --port 3100',
    cwd: '../..',
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore', stderr: 'ignore',
    env: {
      RAHROW_API_ORIGIN: 'http://127.0.0.1:3101',
      RAHROW_WEB_ORIGIN: 'http://127.0.0.1:3100',
    },
  },
});
