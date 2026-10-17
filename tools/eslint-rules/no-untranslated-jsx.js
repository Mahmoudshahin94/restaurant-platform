// @ts-check
/**
 * Flags user-facing text written directly in JSX instead of going through i18next:
 *  - JSX text containing letters:          <p>Save</p>
 *  - string literals in text attributes:   <input placeholder="Email" />, aria-label, title, alt, label
 *  - string literals in JSX expressions:   <p>{'Save'}</p>
 * Text with no letters (punctuation, numbers, symbols such as "·" or "—") is allowed.
 */
const LETTER = /\p{L}/u;
const TEXT_ATTRIBUTES = new Set([
  'title',
  'placeholder',
  'alt',
  'label',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-valuetext',
]);

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require translated (i18next) strings for user-facing JSX text' },
    schema: [],
    messages: {
      text: 'User-facing text "{{text}}" must use a translation key (t(...)).',
    },
  },
  create(context) {
    /** @param {import('estree').Node} node @param {string} text */
    function check(node, text) {
      const trimmed = text.trim();
      if (trimmed && LETTER.test(trimmed)) {
        context.report({ node, messageId: 'text', data: { text: trimmed.slice(0, 40) } });
      }
    }
    return {
      /** @param {any} node */
      JSXText(node) {
        check(node, node.value);
      },
      /** @param {any} node */
      JSXAttribute(node) {
        const name = typeof node.name.name === 'string' ? node.name.name : '';
        if (!TEXT_ATTRIBUTES.has(name) || !node.value) return;
        if (node.value.type === 'Literal' && typeof node.value.value === 'string') {
          check(node.value, node.value.value);
        }
      },
      /** @param {any} node */
      'JSXElement > JSXExpressionContainer > Literal'(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      /** @param {any} node */
      'JSXElement > JSXExpressionContainer > TemplateLiteral'(node) {
        for (const quasi of node.quasis) check(node, quasi.value.cooked ?? '');
      },
    };
  },
};

export default rule;
