import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const composeFile = fileURLToPath(new URL('../infra/compose.local.yaml', import.meta.url));
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
const actions = new Set(['config', 'up', 'down', 'status', 'reset']);

export function localProject(value = 'rahrow-local') {
  if (value !== 'rahrow-local' && !/^rahrow-local-qa-[a-z0-9]{1,32}$/.test(value)) {
    throw new Error('RAHROW_LOCAL_PROJECT must be rahrow-local or rahrow-local-qa-<1–32 lowercase letters/digits>.');
  }
  return value;
}

export function validateLocalEnvironment(env) {
  for (const key of ['POSTGRES_USER', 'POSTGRES_DB']) {
    if (!/^rahrow_local(?:_[a-z0-9_]+)?$/.test(env[key] ?? '')) {
      throw new Error(`${key} must use a local-only rahrow_local name (optional lowercase suffix).`);
    }
  }
  if (!env.POSTGRES_PASSWORD || /[\r\n\0]/.test(env.POSTGRES_PASSWORD)) {
    throw new Error('POSTGRES_PASSWORD must be a non-empty, single-line local development value.');
  }
  if (!/^\d+$/.test(env.POSTGRES_PORT ?? '') || Number(env.POSTGRES_PORT) < 1024 || Number(env.POSTGRES_PORT) > 65535) {
    throw new Error('POSTGRES_PORT must be an unprivileged local port between 1024 and 65535.');
  }
  return env;
}

export function isLocalDockerEndpoint(endpoint) {
  return /^unix:\/\/\/[^\r\n]+$/.test(endpoint) || /^npipe:\/\/\/\/\.\/pipe\/[^\r\n/]+$/.test(endpoint);
}

export function assertOwnedVolume(volume, project) {
  const labels = volume.Labels ?? {};
  if (volume.Name !== `${project}_postgres-data` ||
      labels['com.docker.compose.project'] !== project ||
      labels['com.docker.compose.volume'] !== 'postgres-data' ||
      labels['com.rahrow.environment'] !== 'local' ||
      labels['com.rahrow.component'] !== 'postgres') {
    throw new Error('Refusing reset: the volume is not the expected labeled Rahrow local PostgreSQL volume.');
  }
}

function docker(args, env, capture = false) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error?.code === 'ENOENT') {
    throw new Error('Docker CLI is unavailable. Install Docker with the Compose plugin, then use a local Docker engine.');
  }
  if (result.error || result.status !== 0) {
    // Captured diagnostics can include configuration values; do not print them.
    throw new Error('Docker command failed. Check that Docker and its Compose plugin are installed and the local engine is running.');
  }
  return result.stdout?.trim();
}

function localDaemon(env) {
  let endpoint;
  if (env.DOCKER_CONTEXT || !env.DOCKER_HOST) {
    const context = env.DOCKER_CONTEXT || docker(['context', 'show'], env, true);
    endpoint = docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}'], env, true);
  } else {
    endpoint = env.DOCKER_HOST;
  }
  if (!isLocalDockerEndpoint(endpoint)) {
    throw new Error('Refusing a remote/TCP Docker endpoint. Select a local Docker Desktop or Unix-socket context.');
  }
  // Pin the endpoint that was checked instead of depending on context precedence.
  const localEnv = { ...env };
  delete localEnv.DOCKER_HOST;
  delete localEnv.DOCKER_CONTEXT;
  const dockerArgs = ['--host', endpoint];
  const version = docker([...dockerArgs, 'version', '--format', '{{.Server.Version}}'], localEnv, true);
  if (!/^\d+\./.test(version) || Number(version.split('.')[0]) < 28) {
    throw new Error('Docker Engine 28 or newer is required for the localhost-only published-port boundary.');
  }
  return { dockerArgs, env: localEnv };
}

function inspectVolume(name, dockerArgs, env) {
  const names = docker([...dockerArgs, 'volume', 'ls', '--format', '{{.Name}}'], env, true).split('\n');
  if (!names.includes(name)) return undefined;
  const volumes = JSON.parse(docker([...dockerArgs, 'volume', 'inspect', name], env, true));
  if (volumes.length !== 1) throw new Error('Refusing reset: unexpected volume inspection result.');
  return volumes[0];
}

export function main(args = process.argv.slice(2)) {
  const [action, ...flags] = args;
  if (!actions.has(action) || flags.some((flag) => action !== 'reset' || flag !== '--confirm-local-reset')) {
    throw new Error('Usage: node scripts/db-local.mjs config|up|down|status|reset [--confirm-local-reset]');
  }
  if (action === 'reset' && !flags.includes('--confirm-local-reset')) {
    throw new Error('DESTRUCTIVE LOCAL-ONLY: reset removes this project’s PostgreSQL data. Repeat with --confirm-local-reset only if it is disposable.');
  }
  let fromFile;
  try {
    fromFile = parseEnv(readFileSync(envFile, 'utf8'));
  } catch {
    throw new Error('Missing or unreadable root .env. Copy .env.example to .env and keep it local.');
  }
  const env = validateLocalEnvironment({ ...fromFile, ...process.env });
  const project = localProject(env.RAHROW_LOCAL_PROJECT);
  const compose = ['compose', '--project-name', project, '--env-file', envFile, '--file', composeFile];
  if (action === 'config') {
    docker([...compose, 'config', '--quiet'], env);
    process.stdout.write('Local Compose configuration is valid; no daemon or database connection was checked.\n');
    return;
  }
  const local = localDaemon(env);
  const runCompose = (...command) => docker([...local.dockerArgs, ...compose, ...command], local.env);
  if (action === 'up') runCompose('up', '--detach', '--wait', '--wait-timeout', '90', 'postgres');
  if (action === 'down') runCompose('down', '--timeout', '15');
  if (action === 'status') runCompose('ps', '--all');
  if (action === 'reset') {
    const name = `${project}_postgres-data`;
    const existing = inspectVolume(name, local.dockerArgs, local.env);
    if (existing) assertOwnedVolume(existing, project);
    runCompose('down', '--timeout', '15');
    const remaining = inspectVolume(name, local.dockerArgs, local.env);
    if (remaining) {
      assertOwnedVolume(remaining, project);
      docker([...local.dockerArgs, 'volume', 'rm', name], local.env);
    }
    process.stdout.write(`Removed only the labeled local PostgreSQL volume for ${project}, if present. Run db:up to create an empty one.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
