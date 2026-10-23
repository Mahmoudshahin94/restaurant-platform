// @ts-check
/**
 * Flags colours written into code instead of taken from the design tokens (ADR 0019): Tailwind
 * palette classes (`bg-blue-500`, `text-white`, `bg-black/50`), arbitrary colour classes
 * (`bg-[#123456]`) and colour literals (`'#1e40af'`, `'rgb(0 0 0)'`, `'oklch(…)'`). Screens use
 * semantic tokens (`bg-primary`, `text-muted-foreground`), so the theme and the tenant's branding
 * reach them. The token files and printed receipts (paper is black on white) are exempt in
 * eslint.config.js.
 */

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITY =
  'bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|accent|caret|decoration|placeholder|shadow';
/** `bg-blue-500`, `hover:text-red-600/80`, `bg-white`, `text-black`. */
const PALETTE_CLASS = new RegExp(
  `(?:^|[\\s:!'"\`])-?(?:${UTILITY})-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|black|white)(?:\\/\\d+)?(?=$|[\\s'"\`])`,
);
/** `bg-[#fff]`, `text-[rgb(0,0,0)]`. */
const ARBITRARY_COLOUR = /-\[(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch)\()/i;
/** A literal that is a colour and nothing else. */
const COLOUR_LITERAL =
  /^\s*(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\))\s*$/i;

/** @param {string} text */
function problem(text) {
  if (COLOUR_LITERAL.test(text)) return 'literal';
  if (PALETTE_CLASS.test(text) || ARBITRARY_COLOUR.test(text)) return 'palette';
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Use design tokens, never raw colours' },
    schema: [],
    messages: {
      palette:
        'Use a semantic token class (bg-primary, text-muted-foreground, border-border…), not a palette colour: the theme and the tenant’s branding must reach it.',
      literal:
        'Do not hardcode a colour: use a design token (a CSS variable of packages/ui/src/styles/theme.css).',
    },
  },
  create(context) {
    /** @param {any} node @param {string} text */
    const check = (node, text) => {
      const messageId = problem(text);
      if (messageId) context.report({ node, messageId });
    };
    return {
      /** @param {any} node */
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      /** @param {any} node */
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
      /** @param {any} node */
      JSXText(node) {
        if (PALETTE_CLASS.test(node.value) && /class/.test(node.parent?.type ?? '')) {
          context.report({ node, messageId: 'palette' });
        }
      },
    };
  },
};

export default rule;
