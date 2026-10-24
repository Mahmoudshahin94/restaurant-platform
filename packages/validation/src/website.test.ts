import { BusinessType, WEBSITE_SECTION_TYPES, WebsiteSectionType } from '@pos/shared-types';
import { describe, expect, it } from 'vitest';
import { blankSection, defaultWebsiteConfig } from './website-defaults';
import {
  type WebsiteConfig,
  websiteConfigSchema,
  websiteFileIds,
  websiteHrefSchema,
  websiteSectionSchema,
} from './website';

const fileId = '0199e4a0-0000-7000-8000-000000000001';

describe('website sections', () => {
  it('accepts a blank section of every type', () => {
    for (const [index, type] of WEBSITE_SECTION_TYPES.entries()) {
      const parsed = websiteSectionSchema.safeParse(blankSection(type, `s${String(index)}`, index));
      expect(parsed.success, type).toBe(true);
    }
  });

  it('dispatches on the type: content of another type is refused', () => {
    const hero = blankSection(WebsiteSectionType.HERO, 'hero', 0);
    const about = blankSection(WebsiteSectionType.ABOUT, 'about', 1);
    expect(websiteSectionSchema.safeParse({ ...hero, content: about.content }).success).toBe(false);
    expect(websiteSectionSchema.safeParse({ ...hero, type: 'MARQUEE' }).success).toBe(false);
  });

  it('refuses unknown keys, languages and appearance values', () => {
    const hero = blankSection(WebsiteSectionType.HERO, 'hero', 0);
    expect(websiteSectionSchema.safeParse({ ...hero, html: '<script>' }).success).toBe(false);
    expect(
      websiteSectionSchema.safeParse({
        ...hero,
        content: { ...hero.content, title: { en: 'Hi', fr: 'Salut' } },
      }).success,
    ).toBe(false);
    expect(
      websiteSectionSchema.safeParse({
        ...hero,
        appearance: { background: 'RAINBOW', alignment: 'START' },
      }).success,
    ).toBe(false);
  });

  it('keeps ids usable as anchors and text within its limits', () => {
    const about = blankSection(WebsiteSectionType.ABOUT, 'about', 0);
    expect(websiteSectionSchema.safeParse({ ...about, id: 'About Us' }).success).toBe(false);
    expect(
      websiteSectionSchema.safeParse({
        ...about,
        content: { ...about.content, title: { en: 'x'.repeat(121) } },
      }).success,
    ).toBe(false);
  });
});

describe('links', () => {
  it.each(['#about', '/track', '/l/abc?x=1', 'https://instagram.com/shop'])(
    'accepts %s',
    (href) => {
      expect(websiteHrefSchema.safeParse(href).success).toBe(true);
    },
  );

  it.each([
    'javascript:alert(1)',
    'http://shop.example',
    '//evil.example',
    'data:text/html,hi',
    '#Not An Id',
    'mailto:x@y.z',
  ])('refuses %s', (href) => {
    expect(websiteHrefSchema.safeParse(href).success).toBe(false);
  });
});

describe('website configuration', () => {
  it('starts every business type from a valid template', () => {
    for (const type of [...Object.values(BusinessType), 'UNKNOWN']) {
      const config = defaultWebsiteConfig(type);
      expect(websiteConfigSchema.safeParse(config).success, type).toBe(true);
      expect(config.sections.map((s) => s.type)).toContain(WebsiteSectionType.LOCATIONS);
    }
  });

  it('words the template for the business', () => {
    const food = defaultWebsiteConfig(BusinessType.RESTAURANT);
    const shop = defaultWebsiteConfig(BusinessType.CLOTHING);
    const titleOf = (config: WebsiteConfig) => {
      const hero = config.sections.find((s) => s.type === WebsiteSectionType.HERO);
      return hero?.type === WebsiteSectionType.HERO ? hero.content.title.en : undefined;
    };
    expect(titleOf(food)).not.toBe(titleOf(shop));
  });

  it('refuses duplicate section ids and a second footer', () => {
    const config = defaultWebsiteConfig(BusinessType.RESTAURANT);
    const first = config.sections[0];
    if (!first) throw new Error('template has sections');
    expect(
      websiteConfigSchema.safeParse({ ...config, sections: [...config.sections, first] }).success,
    ).toBe(false);
    expect(
      websiteConfigSchema.safeParse({
        ...config,
        sections: [...config.sections, blankSection(WebsiteSectionType.FOOTER, 'footer-2', 99)],
      }).success,
    ).toBe(false);
  });

  it('accepts only https social links of known networks', () => {
    const config = defaultWebsiteConfig(BusinessType.RESTAURANT);
    const withSocial = (social: unknown) => websiteConfigSchema.safeParse({ ...config, social });
    expect(withSocial([{ network: 'INSTAGRAM', url: 'https://instagram.com/x' }]).success).toBe(
      true,
    );
    expect(withSocial([{ network: 'INSTAGRAM', url: 'http://instagram.com/x' }]).success).toBe(
      false,
    );
    expect(withSocial([{ network: 'MYSPACE', url: 'https://myspace.com/x' }]).success).toBe(false);
  });

  it('lists the files it shows', () => {
    const config = defaultWebsiteConfig(BusinessType.RESTAURANT);
    const gallery = blankSection(WebsiteSectionType.GALLERY, 'gallery', 50);
    if (gallery.type !== WebsiteSectionType.GALLERY) throw new Error('gallery');
    gallery.content.images = [{ fileId, caption: {} }];
    expect(websiteFileIds({ ...config, sections: [...config.sections, gallery] })).toEqual([
      fileId,
    ]);
  });
});
