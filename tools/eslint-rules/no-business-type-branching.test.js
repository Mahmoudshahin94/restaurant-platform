// Run with: node --test tools/eslint-rules
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-business-type-branching.js';

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run('no-business-type-branching', rule, {
  valid: [
    'if (await features.isEnabled(Feature.KDS, scope)) dispatch();',
    'const kitchen = useFeature(Feature.KDS);',
    // Reading, storing and passing the type on is fine: only branching on it is not.
    'const dto = { businessType: row.businessType };',
    'const layers = featureLayersFromRows({ businessType: tenant.businessType, overrides });',
    'const defaults = BUSINESS_TYPE_DEFAULTS[type];',
    "if (row.status === 'ACTIVE') activate();",
  ],
  invalid: [
    {
      code: "if (tenant.businessType === 'RESTAURANT') showTables();",
      errors: [{ messageId: 'branching' }],
    },
    {
      code: 'const retail = BusinessType.CLOTHING !== type;',
      errors: [{ messageId: 'branching' }],
    },
    {
      code: "const cafe = context?.tenant.businessType == 'COFFEE_SHOP';",
      errors: [{ messageId: 'branching' }],
    },
    {
      code: 'switch (businessType) { case "SUPERMARKET": break; }',
      errors: [{ messageId: 'branching' }],
    },
    {
      code: "if (['CLOTHING', 'RETAIL'].includes(tenant.businessType)) hideKitchen();",
      errors: [{ messageId: 'branching' }],
    },
    {
      code: 'const x = (row.businessType as string) === other;',
      errors: [{ messageId: 'branching' }],
    },
  ],
});
