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
      // Money is integer minor units, parsed from decimal strings (ADR 0002, ADR 0020).
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Parse amounts with parseDecimalToMinor (ADR 0002).' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'Parse amounts with parseDecimalToMinor (ADR 0002).',
        },
      ],
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
      // A terminal by its credential at its hub (ADR 0022).
      'packages/server/src/modules/auth/terminal-auth.service.ts',
      // Start-up: new permissions reach every tenant's system roles.
      'packages/server/src/modules/auth/permission-catalog.initializer.ts',
      // The tenant website: finding the tenant of a verified domain (ADR 0023).
      'packages/server/src/modules/website/host-tenant.resolver.ts',
      // The acceptance-timeout sweep finds due orders across tenants.
      'packages/server/src/modules/online-ordering/web-orders.service.ts',
      // The platform admin's directory: tenants, provisioning and the health board (ADR 0025).
      'apps/api/src/modules/platform/platform-directory.service.ts',
      // An account's users in every brand, for sign-in and the brand switcher.
      'apps/api/src/modules/organizations/cloud-account-directory.ts',
      // Key rotation finds secrets sealed with an old key across tenants (ADR 0024).
      'packages/server/src/modules/payments/secrets/payment-secrets.service.ts',
      // The definition itself.
      'packages/server/src/common/tenancy/**/*.ts',
    ],
    rules: { 'pos-local/no-unscoped-prisma': ['error', { allowed: true }] },
  },
  {
    // Modules (ADR 0018): code asks for capabilities, never for the business type. The type's
    // defaults are the one exception.
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    plugins: { 'pos-local': posLocal },
    rules: { 'pos-local/no-business-type-branching': 'error' },
  },
  {
    files: ['packages/domain/src/features/defaults.ts'],
    rules: { 'pos-local/no-business-type-branching': 'off' },
  },
  {
    // Branding (ADR 0019): colours come from the design tokens, so the theme and the tenant's
    // branding reach every screen.
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    plugins: { 'pos-local': posLocal },
    rules: { 'pos-local/no-raw-colors': 'error' },
  },
  {
    files: [
      // Token files: the colours themselves.
      'packages/domain/src/branding/theme-tokens.ts',
      // Receipts are printed: black on white paper, whatever the screen's theme.
      'packages/receipts/src/**/*.ts',
      'apps/pos/src/components/receipt-preview.tsx',
      'apps/pos/src/lib/printing.ts',
      // Tests state colours to check contrast and branding.
      '**/*.test.{ts,tsx}',
      '**/test/**/*.{ts,tsx}',
      '**/e2e/**/*.ts',
    ],
    rules: { 'pos-local/no-raw-colors': 'off' },
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
