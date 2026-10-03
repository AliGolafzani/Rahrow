import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { getLocalDatabaseUrl } from './local-database.ts';

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

test('the Prisma baseline and generated client contain zero models', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  assert.doesNotMatch(schema, /^\s*(model|view|enum|type)\s+\w+\s*\{/m);
  assert.deepEqual(await readdir(new URL('../prisma/', import.meta.url)), ['schema.prisma'], 'No migrations or seed files belong in this baseline.');
  assert.deepEqual(Object.keys(Prisma.ModelName), []);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: getLocalDatabaseUrl(environment) }) });
  await prisma.$disconnect();
});
