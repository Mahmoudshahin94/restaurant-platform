// Run with: node --test tools/eslint-rules
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-raw-colors.js';

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-raw-colors', rule, {
  valid: [
    'const a = <div className="bg-primary text-primary-foreground border-border" />;',
    "const b = cn('surface rounded-lg', active ? 'bg-muted' : 'text-muted-foreground');",
    'const c = `ring-2 ring-ring ${size}`;',
    // Order numbers, anchors and ids are not colours.
    'const d = `#${order.number}`;',
    "const e = '#menu-section';",
    "const f = 'Table #12';",
    "const g = 'text-start whitespace-nowrap';",
    "const h = 'bg-overlay backdrop-blur';",
    "const i = 'border-white-space';",
  ],
  invalid: [
    { code: 'const a = <div className="bg-blue-500" />;', errors: [{ messageId: 'palette' }] },
    { code: "const b = cn('p-2 hover:text-red-600/80');", errors: [{ messageId: 'palette' }] },
    { code: "const c = 'fixed inset-0 bg-black/50';", errors: [{ messageId: 'palette' }] },
    { code: 'const d = `rounded bg-white ${x}`;', errors: [{ messageId: 'palette' }] },
    { code: "const e = 'bg-[#1e40af] p-2';", errors: [{ messageId: 'palette' }] },
    { code: "const f = { color: '#1e40af' };", errors: [{ messageId: 'literal' }] },
    { code: "ctx.fillStyle = '#fff';", errors: [{ messageId: 'literal' }] },
    { code: "const g = 'oklch(0.5 0.1 250)';", errors: [{ messageId: 'literal' }] },
    { code: "const h = 'rgb(0 0 0 / 0.5)';", errors: [{ messageId: 'literal' }] },
  ],
});
