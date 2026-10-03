import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function launch(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let startupError;
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('error', (error) => { startupError = error; });
  return { child, output: () => output, startupError: () => startupError };
}

async function waitForResponse(server, url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.startupError()) throw server.startupError();
    if (server.child.exitCode !== null || server.child.signalCode !== null) {
      throw new Error(`Server exited before readiness:\n${server.output()}`);
    }
    try {
      return await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(1_000) });
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Server did not respond within 30 seconds:\n${server.output()}`);
}

async function stop(server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  const exited = once(server.child, 'exit');
  server.child.kill('SIGTERM');
  await Promise.race([exited, delay(5_000)]);
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill('SIGKILL');
    await exited;
  }
}

test('compiled placeholder packages expose no invented contracts or components', async () => {
  assert.deepEqual(Object.keys(await import('@rahrow/contracts')), []);
  assert.deepEqual(Object.keys(await import('@rahrow/ui')), []);
});

test('built applications start independently and serve only the skeleton', async (t) => {
  const apiPort = await availablePort();
  const api = launch(['dist/main.js'], `${root}apps/api`, { HOST: '127.0.0.1', PORT: String(apiPort) });
  t.after(() => stop(api));
  const apiResponse = await waitForResponse(api, `http://127.0.0.1:${apiPort}/`);
  assert.equal(apiResponse.status, 404, 'The API skeleton intentionally defines no application routes.');
  assert.equal((await apiResponse.json()).statusCode, 404);
  await stop(api);

  const webPort = await availablePort();
  const web = launch([require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], `${root}apps/web`);
  t.after(() => stop(web));
  const webResponse = await waitForResponse(web, `http://127.0.0.1:${webPort}/`);
  assert.equal(webResponse.status, 200);
  const html = await webResponse.text();
  assert.match(html, /<h1>Rahrow<\/h1>/);
  assert.match(html, /Application skeleton\. Product features are not implemented\./);
  await stop(web);
});
