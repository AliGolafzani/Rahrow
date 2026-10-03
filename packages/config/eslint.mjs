import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/node_modules/**', '**/.next/**', '**/dist/**', '**/coverage/**', '**/next-env.d.ts']),
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['apps/api/**/*.ts', 'packages/*/src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [...nextVitals, ...nextTypeScript],
    settings: { next: { rootDir: 'apps/web/' } },
  },
]);
