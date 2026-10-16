import type { Locale, TextDirection } from '@pos/shared-types';

const RTL_LOCALES: ReadonlySet<string> = new Set(['ar']);

export function directionFor(locale: Locale): TextDirection {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

/**
 * Applies `lang` and `dir` to the document root. Layout mirroring relies on CSS logical
 * properties (`ms-*`, `pe-*`, `start-*`) reacting to `dir`, not on per-component overrides.
 */
export function applyDocumentLocale(
  locale: Locale,
  root: HTMLElement = document.documentElement,
): void {
  root.lang = locale;
  root.dir = directionFor(locale);
}
