// @ts-check
/**
 * Flags code that branches on a tenant's business type (ADR 0018): comparing `businessType` (or a
 * `BusinessType.*` value) with `===`/`!==`, switching on it, or looking it up in a list with
 * `.includes`. The type only picks default modules, in `packages/domain/src/features/defaults.ts`,
 * where eslint.config.js turns the rule off. Everywhere else, code asks for a capability:
 * `isEnabled(Feature.KDS)`, `useFeature(Feature.TABLES)`.
 */

const EQUALITY = new Set(['===', '!==', '==', '!=']);

/** `businessType`, `x.businessType`, `x?.businessType` or `BusinessType.RESTAURANT`. */
function isBusinessType(/** @type {any} */ node) {
  if (!node) return false;
  if (node.type === 'ChainExpression') return isBusinessType(node.expression);
  if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression') {
    return isBusinessType(node.expression);
  }
  if (node.type === 'Identifier') return node.name === 'businessType';
  if (node.type !== 'MemberExpression') return false;
  if (!node.computed && node.property.type === 'Identifier') {
    if (node.property.name === 'businessType') return true;
  }
  return node.object.type === 'Identifier' && node.object.name === 'BusinessType';
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Ask for capabilities (modules), never for the business type' },
    schema: [],
    messages: {
      branching:
        'Do not branch on the business type: ask for the capability (isEnabled/useFeature with a Feature). Business-type defaults live in packages/domain/src/features/defaults.ts.',
    },
  },
  create(context) {
    return {
      /** @param {any} node */
      BinaryExpression(node) {
        if (!EQUALITY.has(node.operator)) return;
        if (isBusinessType(node.left) || isBusinessType(node.right)) {
          context.report({ node, messageId: 'branching' });
        }
      },
      /** @param {any} node */
      SwitchStatement(node) {
        if (isBusinessType(node.discriminant)) context.report({ node, messageId: 'branching' });
      },
      /** @param {any} node */
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'includes' &&
          node.arguments.some(isBusinessType)
        ) {
          context.report({ node, messageId: 'branching' });
        }
      },
    };
  },
};

export default rule;
