// Run with: node --test tools/eslint-rules
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-unscoped-prisma.js';

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('no-unscoped-prisma', rule, {
  valid: [
    'await TenantContext.runInTenant(tenantId, () => prisma.order.findMany());',
    {
      code: "await TenantContext.runUnscoped('sign-in: find the account', () => find());",
      options: [{ allowed: true }],
    },
  ],
  invalid: [
    {
      code: "await TenantContext.runUnscoped('reports', () => prisma.order.findMany());",
      errors: [{ messageId: 'unscoped' }],
    },
    {
      code: 'await TenantContext.runUnscoped(reason, () => find());',
      options: [{ allowed: true }],
      errors: [{ messageId: 'reason' }],
    },
    {
      code: "await TenantContext.runUnscoped('  ', () => find());",
      options: [{ allowed: true }],
      errors: [{ messageId: 'reason' }],
    },
  ],
});
