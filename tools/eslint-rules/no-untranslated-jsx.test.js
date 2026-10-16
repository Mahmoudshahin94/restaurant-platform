// Run with: node --test tools/eslint-rules
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-untranslated-jsx.js';

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run('no-untranslated-jsx', rule, {
  valid: [
    'const a = <p>{t("order.total")}</p>;',
    'const a = <p className="flex items-center" />;',
    'const a = <span> · {count} — 12 </span>;',
    'const a = <input placeholder={t("auth.email")} type="email" />;',
    'const a = <Trans i18nKey="x" />;',
  ],
  invalid: [
    { code: 'const a = <p>Save</p>;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <p>حفظ</p>;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <input placeholder="Email" />;', errors: [{ messageId: 'text' }] },
    { code: 'const a = <button aria-label="Close" />;', errors: [{ messageId: 'text' }] },
    { code: "const a = <p>{'Total'}</p>;", errors: [{ messageId: 'text' }] },
    { code: 'const a = <p>{`Total ${x}`}</p>;', errors: [{ messageId: 'text' }] },
  ],
});
