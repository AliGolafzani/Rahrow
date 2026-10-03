import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

export const AUTH_MODELS = [
  'AdminCredential', 'AuditLog', 'AuthRateLimitBucket', 'AuthSession', 'OtpChallenge',
  'Permission', 'Role', 'RolePermission', 'User', 'UserRole',
] as const;

export type CatalogRelation = { schema: string; name: string; kind: string };
export const AUTH_RELATIONS: CatalogRelation[] = [...AUTH_MODELS, '_prisma_migrations']
  .sort()
  .map((name) => ({ schema: 'public', name, kind: 'r' }));

export function assertAuthModels(models: string[]): void {
  assert.deepEqual([...models].sort(), [...AUTH_MODELS]);
}

export function assertRelations(relations: CatalogRelation[], mode: 'empty' | 'auth'): void {
  const sorted = [...relations].sort((a, b) =>
    `${a.schema}.${a.name}.${a.kind}`.localeCompare(`${b.schema}.${b.name}.${b.kind}`, 'en'));
  const expected = mode === 'empty' ? [] : [...AUTH_RELATIONS].sort((a, b) =>
    `${a.schema}.${a.name}.${a.kind}`.localeCompare(`${b.schema}.${b.name}.${b.kind}`, 'en'));
  assert.deepEqual(sorted, expected, 'The schema-qualified relation set must exactly match the authorized phase.');
}

export type MigrationRecord = {
  id: string;
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  started_at: Date;
  applied_steps_count: number;
  logs: string | null;
};

export async function committedMigration(): Promise<{ name: string; checksum: string }> {
  const directory = new URL('../prisma/migrations/', import.meta.url);
  const entries = (await readdir(directory)).sort();
  assert.equal(entries.length, 2, 'AUTH-01 permits one committed migration and its lock file.');
  assert.equal(entries[1], 'migration_lock.toml');
  const name = entries[0]!;
  assert.match(name, /^\d{14}_auth_domain_foundation$/);
  assert.deepEqual(await readdir(new URL(`${name}/`, directory)), ['migration.sql']);
  const sql = await readFile(new URL(`${name}/migration.sql`, directory));
  return { name, checksum: createHash('sha256').update(sql).digest('hex') };
}

export function assertMigrationHistory(
  records: MigrationRecord[], expected: { name: string; checksum: string },
): void {
  assert.equal(records.length, 1, 'Exactly the committed AUTH-01 migration must be applied.');
  const record = records[0]!;
  assert.equal(record.migration_name, expected.name);
  assert.equal(record.checksum, expected.checksum, 'Applied SQL must match the committed migration.');
  assert.ok(record.id);
  assert.ok(record.started_at instanceof Date);
  assert.ok(record.finished_at instanceof Date);
  assert.equal(record.rolled_back_at, null);
  assert.equal(record.applied_steps_count, 1);
  assert.equal(record.logs, null, 'A successfully applied migration must not have failure logs.');
}

export function assertDisposableAuthTestEnvironment(environment: NodeJS.ProcessEnv): void {
  assert.equal(environment.CI, 'true', 'Database mutation checks run only in disposable CI.');
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'Database mutation checks require the isolated GitHub job.');
  assert.match(environment.RAHROW_LOCAL_PROJECT ?? '', /^rahrow-local-qa-[a-f0-9]{32}$/);
  assert.equal(environment.RAHROW_AUTH_DATABASE_TESTS, 'disposable-local-ci', 'Explicit disposable test opt-in is required.');
}
