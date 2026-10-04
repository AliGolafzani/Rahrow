import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';
import { getLocalDatabaseUrl, loadLocalEnvironment } from './local-database.ts';
import {
  assertAuthModels, assertEnums, assertMigrationHistory, assertRelations, committedMigration,
  type CatalogEnum, type CatalogRelation, type MigrationRecord,
} from './auth-schema.ts';

let stage = 'arguments';

async function checkDatabase(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0] === '--empty' ? 'empty' : 'auth';
  if (mode === 'empty') args.shift();
  const [snapshotAction, snapshotPath, ...remaining] = args;
  assert.ok(!remaining.length);
  assert.ok(args.length === 0 || (mode === 'auth' && args.length === 2 && snapshotPath &&
    ['--write-snapshot', '--expect-snapshot'].includes(snapshotAction!)), 'Invalid database verification arguments.');

  stage = 'local connection guard';
  loadLocalEnvironment();
  const connectionString = getLocalDatabaseUrl();
  assertAuthModels(Object.keys(Prisma.ModelName));
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
    stage = 'read-only database identity';
    const [probe] = await prisma.$queryRaw<Array<{ ok: number; database: string; read_only: string }>>`
      SELECT 1 AS ok, current_database() AS database,
        current_setting('transaction_read_only') AS read_only
    `;
    assert.equal(probe?.ok, 1, 'The connectivity query must return 1.');
    assert.equal(probe.database, process.env.POSTGRES_DB, 'The connection must use the local database.');
    assert.equal(probe.read_only, 'on', 'The verification connection must be read-only.');

    stage = `${mode} schema-qualified relation allowlist`;
    const relations = await prisma.$queryRaw<CatalogRelation[]>`
      SELECT namespace.nspname AS schema, relation.relname AS name, relation.relkind::text AS kind
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE left(namespace.nspname, 3) <> 'pg_'
        AND namespace.nspname <> 'information_schema'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ORDER BY namespace.nspname, relation.relname, relation.relkind
    `;
    assertRelations(relations, mode);
    const enums = await prisma.$queryRaw<CatalogEnum[]>`
      SELECT namespace.nspname AS schema, type_row.typname AS name,
        array_agg(enum_row.enumlabel::text ORDER BY enum_row.enumsortorder) AS values
      FROM pg_catalog.pg_type AS type_row
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = type_row.typnamespace
      JOIN pg_catalog.pg_enum AS enum_row ON enum_row.enumtypid = type_row.oid
      WHERE left(namespace.nspname, 3) <> 'pg_' AND namespace.nspname <> 'information_schema'
      GROUP BY namespace.nspname, type_row.typname ORDER BY namespace.nspname, type_row.typname
    `;
    assertEnums(enums, mode);
    if (mode === 'empty') {
      console.log('PASS: Prisma SELECT 1, local read-only connection, zero non-system relations before migration.');
      return;
    }

    stage = 'committed migration history';
    const migrations = await prisma.$queryRaw<MigrationRecord[]>`
      SELECT id, migration_name, checksum, finished_at, rolled_back_at, started_at, applied_steps_count, logs
      FROM public."_prisma_migrations" ORDER BY migration_name, id
    `;
    assertMigrationHistory(migrations, await committedMigration());

    if (snapshotPath) {
      stage = 'migration replay and persistence snapshot';
      const columns = await prisma.$queryRaw`
        SELECT table_schema, table_name, column_name, ordinal_position, data_type, udt_name,
          is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale,
          datetime_precision
        FROM information_schema.columns WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `;
      const constraints = await prisma.$queryRaw`
        SELECT relation.relname AS table_name, constraint_row.conname AS name,
          pg_catalog.pg_get_constraintdef(constraint_row.oid) AS definition
        FROM pg_catalog.pg_constraint AS constraint_row
        JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' ORDER BY relation.relname, constraint_row.conname
      `;
      const indexes = await prisma.$queryRaw`
        SELECT tablename, indexname, indexdef FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public' ORDER BY tablename, indexname
      `;
      const snapshot = JSON.stringify({ relations, enums, migrations, columns, constraints, indexes }, null, 2);
      if (snapshotAction === '--write-snapshot') await writeFile(snapshotPath, `${snapshot}\n`, { flag: 'wx', mode: 0o600 });
      else assert.equal(`${snapshot}\n`, await readFile(snapshotPath, 'utf8'), 'Migration history and schema must remain unchanged.');
    }
    console.log('PASS: Prisma SELECT 1, local read-only connection, exact AUTH-01 schema and committed migration history.');
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await checkDatabase();
} catch {
  // Driver errors and assertion values can expose connection details or schema data.
  console.error(`FAIL: Local database verification failed at ${stage}. Check local configuration and the committed migration; no database changes were made.`);
  process.exitCode = 1;
}
