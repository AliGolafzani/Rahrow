import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { getLocalDatabaseUrl } from './local-database.ts';
import {
  AUTH_ENUMS, AUTH_MODELS, AUTH_RELATIONS, assertAuthModels, assertDisposableAuthTestEnvironment,
  assertEnums, assertMigrationHistory, assertRelations, committedMigration, type MigrationRecord,
} from './auth-schema.ts';

const environment = {
  POSTGRES_USER: 'rahrow_local',
  POSTGRES_PASSWORD: 'rahrow_local_dev_only',
  POSTGRES_DB: 'rahrow_local',
  POSTGRES_PORT: '5432',
  DATABASE_URL: 'postgresql://rahrow_local:rahrow_local_dev_only@127.0.0.1:5432/rahrow_local?schema=public',
};

test('the local connection URL must match the Compose environment', () => {
  assert.equal(getLocalDatabaseUrl(environment), environment.DATABASE_URL);
  assert.throws(() => getLocalDatabaseUrl({}), /settings are missing/);
  const password = 'local@example:/%? #';
  assert.equal(getLocalDatabaseUrl({
    ...environment,
    POSTGRES_PASSWORD: password,
    DATABASE_URL: environment.DATABASE_URL.replace('rahrow_local_dev_only', encodeURIComponent(password)),
  }), environment.DATABASE_URL.replace('rahrow_local_dev_only', encodeURIComponent(password)));
  assert.equal(getLocalDatabaseUrl({
    ...environment, POSTGRES_DB: 'rahrow_local_qa',
    DATABASE_URL: environment.DATABASE_URL.replace('/rahrow_local?', '/rahrow_local_qa?'),
  }), environment.DATABASE_URL.replace('/rahrow_local?', '/rahrow_local_qa?'));
  for (const DATABASE_URL of [
    'invalid',
    environment.DATABASE_URL.replace('127.0.0.1', 'example.com'),
    environment.DATABASE_URL.replace('postgresql:', 'https:'),
    environment.DATABASE_URL.replace('/rahrow_local?', '/production?'),
    environment.DATABASE_URL.replace(':5432/', ':5433/'),
    environment.DATABASE_URL.replace('rahrow_local_dev_only', 'wrong'),
    `${environment.DATABASE_URL}&host=example.com`,
    `${environment.DATABASE_URL}&schema=public`,
    `${environment.DATABASE_URL}#fragment`,
    environment.DATABASE_URL.replace('schema=public', 'schema=private'),
  ]) {
    assert.throws(() => getLocalDatabaseUrl({ ...environment, DATABASE_URL }));
  }
  assert.throws(() => getLocalDatabaseUrl({ ...environment, POSTGRES_DB: 'production' }));
});

test('the Prisma schema and generated client contain exactly the authorized AUTH-01 models', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  assertAuthModels([...schema.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map((match) => match[1]!));
  assertAuthModels(Object.keys(Prisma.ModelName));
  assert.deepEqual((await readdir(new URL('../prisma/', import.meta.url))).sort(), ['migrations', 'schema.prisma']);
  const migration = await committedMigration();
  assert.match(migration.checksum, /^[a-f0-9]{64}$/);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: getLocalDatabaseUrl(environment) }) });
  await prisma.$disconnect();
});

test('schema scope rejects missing, unrelated, duplicate and wrong-schema relations', () => {
  assertRelations([], 'empty');
  assertRelations([...AUTH_RELATIONS].reverse(), 'auth');
  assert.throws(() => assertRelations(AUTH_RELATIONS, 'empty'));
  assert.throws(() => assertRelations([], 'auth'));
  assert.throws(() => assertRelations(AUTH_RELATIONS.slice(1), 'auth'));
  assert.throws(() => assertRelations([...AUTH_RELATIONS, AUTH_RELATIONS[0]!], 'auth'));
  for (const kind of ['r', 'p', 'v', 'm', 'S', 'f']) {
    assert.throws(() => assertRelations([...AUTH_RELATIONS, { schema: 'public', name: 'Unrelated', kind }], 'auth'));
  }
  assert.throws(() => assertRelations(AUTH_RELATIONS.map((relation, index) =>
    index === 0 ? { ...relation, schema: 'other' } : relation), 'auth'));
  assert.throws(() => assertRelations(AUTH_RELATIONS.map((relation, index) =>
    index === 0 ? { ...relation, kind: 'v' } : relation), 'auth'));
  assert.throws(() => assertAuthModels([...AUTH_MODELS, 'Order']));
});

test('migration verification rejects missing, repeated, modified and incomplete history', () => {
  const expected = { name: '20261003190000_auth_domain_foundation', checksum: 'a'.repeat(64) };
  const valid: MigrationRecord = {
    id: 'test-migration', migration_name: expected.name, checksum: expected.checksum,
    started_at: new Date(0), finished_at: new Date(1), rolled_back_at: null, applied_steps_count: 1, logs: null,
  };
  assertMigrationHistory([valid], expected);
  assert.throws(() => assertMigrationHistory([], expected));
  assert.throws(() => assertMigrationHistory([valid, valid], expected));
  for (const invalid of [
    { ...valid, migration_name: 'unrelated' }, { ...valid, checksum: 'b'.repeat(64) },
    { ...valid, finished_at: null }, { ...valid, rolled_back_at: new Date(2) },
    { ...valid, applied_steps_count: 0 }, { ...valid, logs: 'failed' },
  ]) assert.throws(() => assertMigrationHistory([invalid], expected));
});

test('exact schema verification rejects missing, extra, reordered and wrong-schema enum values', () => {
  assertEnums([], 'empty');
  assertEnums(AUTH_ENUMS, 'auth');
  assert.throws(() => assertEnums(AUTH_ENUMS, 'empty'));
  assert.throws(() => assertEnums([], 'auth'));
  const valid = AUTH_ENUMS[0]!;
  for (const enums of [
    [valid, valid], [{ ...valid, schema: 'other' }], [{ ...valid, name: 'Unrelated' }],
    [{ ...valid, values: valid.values.slice(1) }], [{ ...valid, values: [...valid.values, 'UNVERIFIED'] }],
    [{ ...valid, values: [...valid.values].reverse() }],
  ]) assert.throws(() => assertEnums(enums, 'auth'));
});

test('database mutation tests refuse non-CI, normal local and unconfirmed targets', () => {
  const disposable = {
    CI: 'true', GITHUB_ACTIONS: 'true', RAHROW_LOCAL_PROJECT: `rahrow-local-qa-${'a'.repeat(32)}`,
    RAHROW_AUTH_DATABASE_TESTS: 'disposable-local-ci',
  };
  assertDisposableAuthTestEnvironment(disposable);
  assert.throws(() => assertDisposableAuthTestEnvironment({}));
  for (const invalid of [
    { ...disposable, CI: 'false' }, { ...disposable, GITHUB_ACTIONS: '' },
    { ...disposable, RAHROW_LOCAL_PROJECT: 'rahrow-local' },
    { ...disposable, RAHROW_LOCAL_PROJECT: 'rahrow-local-qa-short' },
    { ...disposable, RAHROW_LOCAL_PROJECT: `production-${'a'.repeat(32)}` },
    { ...disposable, RAHROW_AUTH_DATABASE_TESTS: '' },
  ]) assert.throws(() => assertDisposableAuthTestEnvironment(invalid));
});
