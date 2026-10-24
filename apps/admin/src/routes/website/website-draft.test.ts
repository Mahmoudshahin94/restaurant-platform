import { WebsiteSectionType } from '@pos/shared-types';
import { defaultWebsiteConfig, websiteConfigSchema } from '@pos/validation';
import { describe, expect, it } from 'vitest';
import {
  addSection,
  canAdd,
  moveSection,
  newSectionId,
  removeSection,
  sortedSections,
  updateSection,
} from './website-draft';

const template = () => defaultWebsiteConfig('RESTAURANT');
const types = (config: ReturnType<typeof template>) => sortedSections(config).map((s) => s.type);

describe('website draft editing', () => {
  it('moves sections and keeps their order in steps of ten', () => {
    const moved = moveSection(template(), 'featured', -1);
    expect(types(moved).slice(0, 2)).toEqual(['FEATURED_PRODUCTS', 'HERO']);
    expect(sortedSections(moved).map((s) => s.order)).toEqual(
      sortedSections(moved).map((_, i) => i * 10),
    );
    // At either end nothing moves.
    expect(moveSection(template(), 'hero', -1)).toEqual(template());
    expect(moveSection(template(), 'footer', 1)).toEqual(template());
  });

  it('adds a section before the footer, with a free anchor id', () => {
    const first = addSection(template(), WebsiteSectionType.GALLERY);
    if (!first) throw new Error('added');
    expect(first.id).toBe('gallery');
    expect(types(first.config).slice(-2)).toEqual(['GALLERY', 'FOOTER']);
    const second = addSection(first.config, WebsiteSectionType.GALLERY);
    expect(second?.id).toBe('gallery-2');
    expect(websiteConfigSchema.safeParse(second?.config).success).toBe(true);
    expect(newSectionId(template(), WebsiteSectionType.PROMO_BANNER)).toBe('promo-banner');
  });

  it('allows one footer only', () => {
    expect(canAdd(template(), WebsiteSectionType.FOOTER)).toBe(false);
    const withoutFooter = removeSection(template(), 'footer');
    expect(canAdd(withoutFooter, WebsiteSectionType.FOOTER)).toBe(true);
  });

  it('updates and removes one section', () => {
    const hidden = updateSection(template(), 'about', (s) => ({ ...s, enabled: false }));
    expect(hidden.sections.find((s) => s.id === 'about')?.enabled).toBe(false);
    const removed = removeSection(hidden, 'about');
    expect(removed.sections.map((s) => s.id)).not.toContain('about');
    expect(websiteConfigSchema.safeParse(removed).success).toBe(true);
  });
});
