import type { Locale } from '@pos/shared-types';

type LocalizedFields<F extends string> = Record<`${F}En` | `${F}Ar`, string | null | undefined>;

/**
 * Picks the localized column (`nameEn` / `nameAr`, `descriptionEn` / ...) for the active locale,
 * falling back to English, then Arabic, when the preferred value is missing.
 */
export function pickLocalized<F extends string>(
  entity: LocalizedFields<F>,
  field: F,
  locale: Locale,
): string {
  const en = entity[`${field}En`];
  const ar = entity[`${field}Ar`];
  const preferred = locale === 'ar' ? ar : en;
  return preferred ?? en ?? ar ?? '';
}
