import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import { assertOwnedVolume, isLocalDockerEndpoint, localProject, main, validateLocalEnvironment } from './db-local.mjs';

const validEnv = {
  POSTGRES_USER: 'rahrow_local',
  POSTGRES_PASSWORD: 'local_example_only',
  POSTGRES_DB: 'rahrow_local',
  POSTGRES_PORT: '5432',
};

test('local lifecycle accepts only its default or isolated QA project namespace', () => {
  assert.equal(localProject(), 'rahrow-local');
  assert.equal(localProject('rahrow-local-qa-20261003'), 'rahrow-local-qa-20261003');
  for (const name of ['production', '', 'rahrow-local-other', 'rahrow-local-qa-../../data', 'rahrow-local-qa-A']) {
    assert.throws(() => localProject(name));
  }
});

test('local lifecycle rejects remote Docker endpoints', () => {
  assert.equal(isLocalDockerEndpoint('unix:///var/run/docker.sock'), true);
  assert.equal(isLocalDockerEndpoint('unix:///run/user/1000/docker.sock'), true);
  assert.equal(isLocalDockerEndpoint('npipe:////./pipe/docker_engine'), true);
  for (const endpoint of ['tcp://127.0.0.1:2375', 'ssh://remote', 'npipe:////server/pipe/docker_engine', '', 'unix://remote/socket']) {
    assert.equal(isLocalDockerEndpoint(endpoint), false);
  }
});

test('local environment validates required values without exposing password', () => {
  assert.equal(validateLocalEnvironment(validEnv), validEnv);
  for (const env of [
    { ...validEnv, POSTGRES_DB: 'production' },
    { ...validEnv, POSTGRES_USER: 'postgres' },
    { ...validEnv, POSTGRES_PASSWORD: '' },
    { ...validEnv, POSTGRES_PASSWORD: 'secret\nline' },
    { ...validEnv, POSTGRES_PORT: '80' },
    { ...validEnv, POSTGRES_PORT: '65536' },
    { ...validEnv, POSTGRES_PORT: '5432oops' },
  ]) assert.throws(() => validateLocalEnvironment(env));
});

test('reset requires explicit local data-loss confirmation before reading environment or calling Docker', () => {
  assert.throws(() => main(['reset']), /DESTRUCTIVE LOCAL-ONLY/);
  assert.throws(() => main(['reset', '--force']), /Usage/);
  assert.throws(() => main(['up', '--confirm-local-reset']), /Usage/);
});

test('reset rejects unnamed, unowned, differently scoped or mismatched volumes', () => {
  const project = 'rahrow-local-qa-example';
  const volume = {
    Name: `${project}_postgres-data`,
    Labels: {
      'com.docker.compose.project': project,
      'com.docker.compose.volume': 'postgres-data',
      'com.rahrow.environment': 'local',
      'com.rahrow.component': 'postgres',
    },
  };
  assert.doesNotThrow(() => assertOwnedVolume(volume, project));
  assert.throws(() => assertOwnedVolume({ ...volume, Name: 'other' }, project));
  assert.throws(() => assertOwnedVolume({ ...volume, Labels: null }, project));
  for (const key of Object.keys(volume.Labels)) {
    assert.throws(() => assertOwnedVolume({ ...volume, Labels: { ...volume.Labels, [key]: 'other' } }, project));
  }
});

// Exercise the actual CLI entry point in an isolated fixture. The preloaded tripwire
// records any attempted Docker spawn; no Docker executable or daemon is used.
function resetCli(t, flags) {
  const root = mkdtempSync(join(tmpdir(), 'rahrow-reset-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(new URL('./db-local.mjs', import.meta.url), join(root, 'scripts/db-local.mjs'));
  writeFileSync(join(root, '.env'), 'POSTGRES_DB=production\n');
  const marker = join(root, 'docker-called');
  const preload = join(root, 'tripwire.mjs');
  writeFileSync(preload, `
    import childProcess from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.spawnSync = () => {
      writeFileSync(${JSON.stringify(marker)}, 'unexpected Docker call');
      throw new Error('Unexpected Docker call');
    };
    syncBuiltinESMExports();
  `);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(POSTGRES_|DOCKER_|RAHROW_|NODE_OPTIONS$|npm_config_)/i.test(key)) delete env[key];
  }
  // Neither environment variables nor npm configuration can replace argv consent.
  env.POSTGRES_USER = 'rahrow_local';
  env.POSTGRES_DB = 'production';
  env.CONFIRM_LOCAL_RESET = 'true';
  env.npm_config_confirm_local_reset = 'true';
  env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
  const result = spawnSync(process.execPath, ['scripts/db-local.mjs', 'reset', ...flags], {
    cwd: root, env, encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(existsSync(marker), false, 'must refuse before any Docker call');
  return result.stderr;
}

test('direct reset CLI without confirmation refuses before environment validation or Docker', (t) => {
  assert.match(resetCli(t, []), /DESTRUCTIVE LOCAL-ONLY:.*node scripts\/db-local\.mjs reset --confirm-local-reset/);
});

test('direct reset CLI with incorrect confirmation refuses before environment validation or Docker', (t) => {
  assert.match(resetCli(t, ['--confirm-local-reset=true']), /Usage:/);
});

test('documented direct Node confirmation passes consent and still enforces local environment guards', (t) => {
  assert.match(resetCli(t, ['--confirm-local-reset']), /POSTGRES_DB must use a local-only rahrow_local name/);
});
