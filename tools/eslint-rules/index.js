// @ts-check
import noUnscopedPrisma from './no-unscoped-prisma.js';
import noUntranslatedJsx from './no-untranslated-jsx.js';

/** Repository-local ESLint rules. */
export default {
  meta: { name: 'pos-local' },
  rules: {
    'no-unscoped-prisma': noUnscopedPrisma,
    'no-untranslated-jsx': noUntranslatedJsx,
  },
};
