import assert from 'node:assert/strict';
import process from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.ts';
import { getLocalDatabaseUrl, loadLocalEnvironment } from './local-database.ts';

async function checkDatabase(): Promise<void> {
  loadLocalEnvironment();
  const connectionString = getLocalDatabaseUrl();
  assert.deepEqual(Object.keys(Prisma.ModelName), [], 'This baseline must have zero Prisma models.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
      options: '-c default_transaction_read_only=on',
    }, { schema: 'public' }),
  });

  try {
    const [probe] = await prisma.$queryRaw<Array<{ ok: number; database: string; read_only: string }>>`
      SELECT 1 AS ok, current_database() AS database,
        current_setting('transaction_read_only') AS read_only
    `;
    assert.equal(probe?.ok, 1, 'The connectivity query must return 1.');
    assert.equal(probe.database, process.env.POSTGRES_DB, 'The connection must use the local database.');
    assert.equal(probe.read_only, 'on', 'The verification connection must be read-only.');

    const [catalog] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::integer AS count
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE left(namespace.nspname, 3) <> 'pg_'
        AND namespace.nspname <> 'information_schema'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    `;
    assert.equal(catalog?.count, 0, 'Expected no non-system tables, views, sequences or foreign tables.');
    console.log('PASS: Prisma SELECT 1, local read-only connection, zero models and zero non-system relations.');
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await checkDatabase();
} catch {
  // Driver errors can include connection details. Never echo credentials or URLs.
  console.error('FAIL: Local database verification failed. Check .env, run npm run db:up and npm run db:status, and confirm the local database is empty.');
  process.exitCode = 1;
}
