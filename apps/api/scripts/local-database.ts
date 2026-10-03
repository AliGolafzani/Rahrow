import { existsSync } from 'node:fs';
import process, { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export function loadLocalEnvironment(): void {
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(path)) loadEnvFile(path);
}

// This is a local development boundary, not a production connection policy.
export function getLocalDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const { DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_PORT } = environment;
  if (!DATABASE_URL || !POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB || !POSTGRES_PORT) {
    throw new Error('Local database settings are missing. Copy .env.example to .env at the repository root.');
  }

  let url: URL;
  try {
    url = new URL(DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL must be a valid local PostgreSQL URL.');
  }

  if (
    url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
    !/^\d+$/.test(POSTGRES_PORT) || Number(POSTGRES_PORT) < 1024 || Number(POSTGRES_PORT) > 65535 ||
    (url.port || '5432') !== POSTGRES_PORT ||
    url.pathname !== `/${POSTGRES_DB}` ||
    !/^rahrow_local(?:_[a-z0-9_]+)?$/.test(POSTGRES_DB) ||
    !/^rahrow_local(?:_[a-z0-9_]+)?$/.test(POSTGRES_USER) || /[\r\n\0]/.test(POSTGRES_PASSWORD) ||
    url.username !== encodeURIComponent(POSTGRES_USER) ||
    url.password !== encodeURIComponent(POSTGRES_PASSWORD) || url.hash ||
    [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public') ||
    url.searchParams.getAll('schema').length > 1
  ) {
    throw new Error('DATABASE_URL must match the local Compose credentials, port and local-only rahrow_local database name on 127.0.0.1; only schema=public is allowed.');
  }

  return DATABASE_URL;
}
