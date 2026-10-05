import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';
const require = createRequire(import.meta.url);
// Explicit cross-platform local-only alternative; never replaces the guarded CI database mode.
const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', 'apps/web/playwright.config.ts'], {
  env: { ...process.env, RAHROW_WEB_E2E_MODE: 'contract' }, stdio: 'inherit',
});
child.on('error', () => { process.stderr.write('Local browser test runner could not start.\n'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
