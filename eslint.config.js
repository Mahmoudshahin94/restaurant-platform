// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import posLocal from './tools/eslint-rules/index.js';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.vite/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.config.{js,mjs,cjs,ts}',
      // temp files Vite/tsup write beside configs while tests or builds run in parallel
      '**/*.timestamp-*.mjs',
      '**/*.bundled_*.{js,mjs,cjs}',
      '**/src-tauri/**',
      'tools/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // NestJS modules and DI classes are legitimately empty / static-only.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    // Plain JS helper scripts are not part of any tsconfig; lint them without type information.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // NestJS relies on runtime type metadata for DI, so constructor-injected types cannot be type-only imports.
    files: ['apps/api/**/*.ts', 'apps/gateway/**/*.ts', 'packages/server/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // Tenant isolation (ADR 0017): server code works inside one tenant. Cross-tenant work is
    // limited to the reviewed files below.
    files: ['apps/api/src/**/*.ts', 'apps/gateway/src/**/*.ts', 'packages/server/src/**/*.ts'],
    plugins: { 'pos-local': posLocal },
    rules: { 'pos-local/no-unscoped-prisma': 'error' },
  },
  {
    files: [
      // Finding an account by e-mail, a device by its credential.
      'packages/server/src/modules/auth/auth.service.ts',
      'apps/api/src/modules/devices/device.guard.ts',
      // Start-up: new permissions reach every tenant's system roles.
      'packages/server/src/modules/auth/permission-catalog.initializer.ts',
      // The customer website: finding the tenant of a slug, location or tracked order.
      'packages/server/src/modules/online-ordering/public-tenant.resolver.ts',
      // The acceptance-timeout sweep finds due orders across tenants.
      'packages/server/src/modules/online-ordering/web-orders.service.ts',
      // The definition itself.
      'packages/server/src/common/tenancy/**/*.ts',
    ],
    rules: { 'pos-local/no-unscoped-prisma': ['error', { allowed: true }] },
  },
  {
    files: ['apps/*/src/**/*.tsx', 'packages/ui/src/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'pos-local': posLocal },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Every user-facing string must go through i18next.
      'pos-local/no-untranslated-jsx': 'error',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'pos-local/no-untranslated-jsx': 'off',
    },
  },
);
