import { describe, expect, it } from 'vitest';
import { loginRequestSchema } from './auth';
import { minorUnitsSchema } from './common';
import {
  createLocationSchema,
  createTenantSchema,
  supportedLocalesSchema,
  updateTenantSchema,
} from './tenancy';

describe('tenancy schemas', () => {
  it('accepts a valid tenant and normalizes the slug', () => {
    const parsed = createTenantSchema.parse({
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
      createTenantSchema.safeParse({ ...base, currencyCode: 'XYZ', timezone: 'UTC' }).success,
    ).toBe(false);
    expect(
      createTenantSchema.safeParse({ ...base, currencyCode: 'SAR', timezone: 'Mars/Base' }).success,
    ).toBe(false);
  });

  it('defaults the profile of a new tenant and keeps its default locale supported', () => {
    const base = {
      slug: 'corner-shop',
      nameEn: 'Corner Shop',
      nameAr: 'متجر الزاوية',
      currencyCode: 'USD',
      defaultLocale: 'ar',
      timezone: 'Asia/Hebron',
    } as const;
    expect(createTenantSchema.parse(base)).toMatchObject({
      businessType: 'RESTAURANT',
      legalName: null,
    });
    expect(createTenantSchema.parse({ ...base, businessType: 'CLOTHING' }).businessType).toBe(
      'CLOTHING',
    );
    expect(createTenantSchema.safeParse({ ...base, businessType: 'CASINO' }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, supportedLocales: ['en'] }).success).toBe(false);
    expect(createTenantSchema.safeParse({ ...base, supportedLocales: ['ar'] }).success).toBe(true);
  });

  it('provisions new tenants in shekels unless told otherwise (ADR 0020)', () => {
    const base = {
      slug: 'new-shop',
      nameEn: 'New Shop',
      nameAr: 'متجر جديد',
      defaultLocale: 'ar',
      timezone: 'Asia/Hebron',
    } as const;
    expect(createTenantSchema.parse(base).currencyCode).toBe('ILS');
    expect(createTenantSchema.parse({ ...base, currencyCode: 'JOD' }).currencyCode).toBe('JOD');
  });

  it('refuses empty or repeated supported locales', () => {
    expect(supportedLocalesSchema.safeParse([]).success).toBe(false);
    expect(supportedLocalesSchema.safeParse(['en', 'en']).success).toBe(false);
    expect(supportedLocalesSchema.safeParse(['ar', 'en']).success).toBe(true);
  });

  it('leaves languages to the localization settings', () => {
    expect(updateTenantSchema.safeParse({ supportedLocales: ['ar'] }).success).toBe(false);
    expect(updateTenantSchema.safeParse({ defaultLocale: 'ar' }).success).toBe(false);
    expect(updateTenantSchema.safeParse({ timezone: 'Asia/Hebron' }).success).toBe(true);
  });

  it('rejects empty updates', () => {
    expect(updateTenantSchema.safeParse({}).success).toBe(false);
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
