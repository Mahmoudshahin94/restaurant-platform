// @ts-check
import noUntranslatedJsx from './no-untranslated-jsx.js';

/** Repository-local ESLint rules. */
export default {
  meta: { name: 'pos-local' },
  rules: { 'no-untranslated-jsx': noUntranslatedJsx },
};
