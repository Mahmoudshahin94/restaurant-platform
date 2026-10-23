// @ts-check
/**
 * Flags `TenantContext.runUnscoped(...)` (ADR 0017). Unscoped database access crosses tenants, so
 * it is allowed only in the files eslint.config.js lists (sign-in lookups, the device guard, the
 * public storefront's tenant resolution, start-up and sweeps); everywhere else the rule reports
 * it. Where it is allowed, the reason must be a non-empty string literal, so a reviewer reads why.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep unscoped (cross-tenant) database access to an allowlist of files' },
    schema: [
      { type: 'object', properties: { allowed: { type: 'boolean' } }, additionalProperties: false },
    ],
    messages: {
      unscoped:
        'runUnscoped crosses tenants; scope the work with runInTenant, or add this file to the reviewed allowlist in eslint.config.js.',
      reason: 'runUnscoped needs a string literal saying why the work is cross-tenant.',
    },
  },
  create(context) {
    const allowed = Boolean(context.options[0]?.allowed);
    return {
      /** @param {any} node */
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
            ? callee.property.name
            : callee.type === 'Identifier'
              ? callee.name
              : null;
        if (name !== 'runUnscoped') return;
        if (!allowed) {
          context.report({ node, messageId: 'unscoped' });
          return;
        }
        const reason = node.arguments[0];
        if (
          !reason ||
          reason.type !== 'Literal' ||
          typeof reason.value !== 'string' ||
          !reason.value.trim()
        ) {
          context.report({ node, messageId: 'reason' });
        }
      },
    };
  },
};

export default rule;
