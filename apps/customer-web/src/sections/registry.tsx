import type { WebsiteSectionType } from '@pos/shared-types';
import type { PublicSite, WebsiteSection, WebsiteSectionOf } from '@pos/validation';
import type { ComponentType } from 'react';
import { CategoriesSection, FeaturedProductsSection } from './catalog-sections';
import {
  AboutSection,
  ContactSection,
  FooterSection,
  GallerySection,
  HeroSection,
  PromoBannerSection,
  TestimonialsSection,
} from './content-sections';
import { LocationsSection, OpeningHoursSection } from './location-sections';
import { SiteContext } from './section-kit';

type Renderers = { [T in WebsiteSectionType]: ComponentType<{ section: WebsiteSectionOf<T> }> };

/**
 * The website's building blocks (ADR 0023): one component per section type. Typed as a complete
 * map, so a new section type does not compile until it has a renderer.
 */
export const SECTION_RENDERERS: Renderers = {
  HERO: HeroSection,
  FEATURED_PRODUCTS: FeaturedProductsSection,
  CATEGORIES: CategoriesSection,
  ABOUT: AboutSection,
  GALLERY: GallerySection,
  TESTIMONIALS: TestimonialsSection,
  LOCATIONS: LocationsSection,
  CONTACT: ContactSection,
  OPENING_HOURS: OpeningHoursSection,
  PROMO_BANNER: PromoBannerSection,
  FOOTER: FooterSection,
};

/** The sections visitors see: enabled ones, in their order. */
export function visibleSections(sections: readonly WebsiteSection[]): WebsiteSection[] {
  return sections.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
}

function RenderSection({ section }: { section: WebsiteSection }) {
  // The registry pairs each type with its component; TypeScript cannot follow the pairing
  // through the union, hence the widening.
  const Renderer = SECTION_RENDERERS[section.type] as ComponentType<{ section: WebsiteSection }>;
  return <Renderer section={section} />;
}

/** Renders a website's page from its configuration. */
export function SectionList({ site }: { site: PublicSite }) {
  return (
    <SiteContext.Provider value={site}>
      <div className="grid gap-6">
        {visibleSections(site.website.sections).map((section) => (
          <RenderSection key={section.id} section={section} />
        ))}
      </div>
    </SiteContext.Provider>
  );
}
