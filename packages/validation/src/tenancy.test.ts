import { describe, expect, it } from 'vitest';
import { loginRequestSchema } from './auth';
import { minorUnitsSchema } from './common';
import { createLocationSchema, createRestaurantSchema, updateRestaurantSchema } from './tenancy';

describe('tenancy schemas', () => {
  it('accepts a valid restaurant and normalizes the slug', () => {
    const parsed = createRestaurantSchema.parse({
      slug: 'Demo-Grill',
      nameEn: 'Demo Grill',
      nameAr: 'ديمو جريل',
      currencyCode: 'KWD',
      defaultLocale: 'ar',
      timezone: 'Asia/Kuwait',
    });
    expect(parsed.slug).toBe('demo-grill');
  });

  it('rejects unsupported currencies and unknown timezones', () => {
    const base = {
      slug: 'x',
      nameEn: 'x',
      nameAr: 'x',
      defaultLocale: 'en',
    };
    expect(
      createRestaurantSchema.safeParse({ ...base, currencyCode: 'XYZ', timezone: 'UTC' }).success,
    ).toBe(false);
    expect(
      createRestaurantSchema.safeParse({ ...base, currencyCode: 'SAR', timezone: 'Mars/Base' })
        .success,
    ).toBe(false);
  });

  it('rejects empty updates', () => {
    expect(updateRestaurantSchema.safeParse({}).success).toBe(false);
  });

  it('uppercases location codes', () => {
    const parsed = createLocationSchema.parse({
      code: 'ryd1',
      nameEn: 'Riyadh',
      nameAr: 'الرياض',
      timezone: 'Asia/Riyadh',
      taxInclusive: true,
    });
    expect(parsed.code).toBe('RYD1');
    expect(parsed.addressLine).toBeNull();
  });
});

describe('money schema', () => {
  it('rejects floats', () => {
    expect(minorUnitsSchema.safeParse(18.5).success).toBe(false);
    expect(minorUnitsSchema.safeParse(1850).success).toBe(true);
  });
});

describe('login schema', () => {
  it('lowercases email and defaults client to web', () => {
    const parsed = loginRequestSchema.parse({ email: 'Owner@Example.COM', password: 'x' });
    expect(parsed).toEqual({ email: 'owner@example.com', password: 'x', client: 'web' });
  });
});
