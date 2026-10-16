import { ERROR_CODES } from '@pos/shared-types';
import { describe, expect, it } from 'vitest';
import { directionFor } from './direction';
import { formatMoney } from './format';
import { initI18n } from './init';
import { pickLocalized } from './localized';
import { NAMESPACES, resources } from './resources';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Keys with plural suffixes collapsed to their base, so languages compare by meaning. */
function baseKeys(value: unknown): string[] {
  return [...new Set(keyPaths(value).map((k) => k.replace(PLURAL_SUFFIX, '')))].sort();
}

describe('translation resources', () => {
  it.each(NAMESPACES)('Arabic namespace "%s" has exactly the English keys', (ns) => {
    expect(baseKeys(resources.ar[ns])).toEqual(baseKeys(resources.en[ns]));
  });

  it.each(['en', 'ar'] as const)('%s defines every plural category its grammar needs', (lng) => {
    const categories = new Intl.PluralRules(lng).resolvedOptions().pluralCategories;
    for (const ns of NAMESPACES) {
      const keys = keyPaths(resources[lng][ns]);
      const pluralBases = new Set(
        keys.filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')),
      );
      for (const base of pluralBases) {
        const missing = categories.filter((c) => !keys.includes(`${base}_${c}`));
        expect(missing, `${lng}/${ns}:${base}`).toEqual([]);
      }
    }
  });

  it('pluralizes Arabic counts with the right forms', async () => {
    const i18n = await initI18n({ locale: 'ar' });
    expect(i18n.t('menu:modifierGroups.count', { count: 2 })).toBe('خياران');
    expect(i18n.t('menu:modifierGroups.count', { count: 5 })).toBe('5 خيارات');
    expect(i18n.t('menu:modifierGroups.count', { count: 11 })).toBe('11 خيارًا');
  });

  it('has no empty strings', () => {
    for (const lng of ['en', 'ar'] as const) {
      for (const ns of NAMESPACES) {
        const empty = keyPaths(resources[lng][ns]).filter((path) => {
          const leaf = path
            .split('.')
            .reduce<unknown>(
              (node, key) => (node as Record<string, unknown>)[key],
              resources[lng][ns],
            );
          return typeof leaf !== 'string' || leaf.trim() === '';
        });
        expect(empty, `${lng}/${ns}`).toEqual([]);
      }
    }
  });

  it('translates every API error code', () => {
    const keys = Object.keys(resources.en.errors);
    expect(ERROR_CODES.filter((code) => !keys.includes(code))).toEqual([]);
  });
});

describe('initI18n', () => {
  it('serves Arabic with English fallback and interpolation', async () => {
    const i18n = await initI18n({ locale: 'ar' });
    expect(i18n.t('actions.save')).toBe('حفظ');
    expect(i18n.t('admin:header.signedInAs', { name: 'سارة' })).toBe('مسجّل الدخول باسم سارة');
    await i18n.changeLanguage('en');
    expect(i18n.t('errors:PRODUCT_UNAVAILABLE')).toBe('This product is currently unavailable.');
  });
});

describe('direction and formatting', () => {
  it('maps locales to text direction', () => {
    expect(directionFor('ar')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
  });

  it('formats money from minor units with the currency precision', () => {
    expect(formatMoney(1850, 'USD', 'en')).toBe('$18.50');
    expect(formatMoney(1500, 'KWD', 'en')).toContain('1.500');
    expect(formatMoney(1850, 'SAR', 'ar')).toContain('18.50');
    expect(formatMoney(1850, 'SAR', 'ar', { digits: 'arab' })).toContain('١٨');
  });

  it('places explicit signs per locale', () => {
    expect(formatMoney(300, 'USD', 'en', { sign: 'exceptZero' })).toBe('+$3.00');
    expect(formatMoney(0, 'USD', 'en', { sign: 'exceptZero' })).toBe('$0.00');
  });

  it('formats very large amounts exactly', () => {
    expect(formatMoney(900_719_925_474_099, 'USD', 'en')).toBe('$9,007,199,254,740.99');
  });

  it('picks localized fields with fallback', () => {
    expect(pickLocalized({ nameEn: 'Burger', nameAr: 'برجر' }, 'name', 'ar')).toBe('برجر');
    expect(pickLocalized({ nameEn: 'Burger', nameAr: null }, 'name', 'ar')).toBe('Burger');
  });
});
