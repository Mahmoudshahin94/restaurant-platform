import { describe, expect, it } from 'vitest';
import { currencySymbolSchema, updateLocalizationSchema } from './localization';

const valid = {
  defaultLocale: 'ar',
  supportedLocales: ['ar', 'en'],
  digits: null,
  currencySymbol: null,
  currencyDisplay: null,
  currencyFormatLocale: null,
} as const;

describe('localization schemas (ADR 0020)', () => {
  it('accepts a complete set of settings, null inheriting', () => {
    expect(updateLocalizationSchema.parse(valid)).toEqual(valid);
    expect(
      updateLocalizationSchema.parse({
        ...valid,
        supportedLocales: ['ar'],
        digits: 'arab',
        currencySymbol: ' JD ',
        currencyDisplay: 'symbol',
        currencyFormatLocale: 'ar-JO',
      }),
    ).toMatchObject({ currencySymbol: 'JD', digits: 'arab', currencyFormatLocale: 'ar-JO' });
  });

  it('keeps the default locale among the supported ones', () => {
    const result = updateLocalizationSchema.safeParse({ ...valid, supportedLocales: ['en'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['supportedLocales']);
  });

  it('refuses unknown locales, displays and format locales', () => {
    for (const bad of [
      { supportedLocales: ['ar', 'fr'] },
      { currencyDisplay: 'name' },
      { currencyFormatLocale: 'xx-YY' },
      { digits: 'thai' },
    ]) {
      expect(updateLocalizationSchema.safeParse({ ...valid, ...bad }).success).toBe(false);
    }
  });

  it('never accepts the currency or its decimal places', () => {
    expect(updateLocalizationSchema.safeParse({ ...valid, currencyCode: 'USD' }).success).toBe(
      false,
    );
    expect(updateLocalizationSchema.safeParse({ ...valid, decimalPlaces: 3 }).success).toBe(false);
  });

  it('accepts short symbols without digits or control characters', () => {
    for (const ok of ['₪', 'NIS', 'د.أ', 'JD', 'US$']) {
      expect(currencySymbolSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['', '   ', '1₪', '٣JD', 'TOOLONGSYM', '\u200f₪', 'a\nb']) {
      expect(currencySymbolSchema.safeParse(bad).success).toBe(false);
    }
  });
});
