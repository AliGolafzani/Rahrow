import { defineConfig, globalIgnores } from 'eslint/config';
import shared from '@rahrow/config/eslint';

export default defineConfig([
  globalIgnores(['apps/api/src/generated/prisma/**']),
  ...shared,
]);
