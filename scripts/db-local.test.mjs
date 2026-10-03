import assert from 'node:assert/strict';
import test from 'node:test';
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
