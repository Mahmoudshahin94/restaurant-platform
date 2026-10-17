import type { Locale } from '@pos/shared-types';

/** Joins option names with the locale's list separator ("Medium, Cheese" / "متوسط، جبن"). */
export function joinNames(names: readonly string[], locale: Locale): string {
  return names.join(locale === 'ar' ? '، ' : ', ');
}
