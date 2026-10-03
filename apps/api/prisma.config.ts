import process from 'node:process';
import { defineConfig } from 'prisma-cli/config';
import { getLocalDatabaseUrl, loadLocalEnvironment } from './scripts/local-database.ts';

loadLocalEnvironment();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Validation/generation are offline. Database commands require the local .env.
  datasource: { url: process.env.DATABASE_URL ? getLocalDatabaseUrl() : '' },
});
