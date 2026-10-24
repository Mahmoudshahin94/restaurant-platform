import { LocalizationProvider } from '@pos/app-kit';
import { SectionBackground, WEBSITE_SECTION_TYPES, WebsiteSectionType } from '@pos/shared-types';
import {
  type PublicLocation,
  type PublicSite,
  type WebsiteSection,
  blankSection,
} from '@pos/validation';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { id, menu, publicSite } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { SECTION_RENDERERS, SectionList, visibleSections } from './registry';

const location: PublicLocation = {
  id: id(81),
  tenantId: id(80),
  code: 'MAIN',
  nameEn: 'Main Branch',
  nameAr: 'الفرع الرئيسي',
  addressLine: 'Al-Irsal Street',
  phone: null,
  timezone: 'Asia/Hebron',
  currencyCode: 'ILS',
  taxInclusive: true,
  status: { state: 'OPEN', reason: null },
  openingHours: [],
  pickupEnabled: true,
  deliveryEnabled: false,
  deliveryFee: 0,
  acceptMinutes: 10,
  onlineCardEnabled: false,
};

/** A site showing only `sections`. */
function siteWith(sections: WebsiteSection[], overrides: Partial<PublicSite> = {}): PublicSite {
  const base = publicSite('en', ['en', 'ar'], { locations: [location], ...overrides });
  return { ...base, website: { ...base.website, sections } };
}

/** Serves the branch's menu, as the API would. */
function serveMenu() {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ...menu, currencyCode: 'ILS' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

function hero(order: number, en: string, ar?: string) {
  const section = blankSection(WebsiteSectionType.HERO, `hero-${String(order)}`, order);
  if (section.type !== WebsiteSectionType.HERO) throw new Error('hero');
  section.content.title = { en, ...(ar ? { ar } : {}) };
  return section;
}

const render = (site: PublicSite, locale: 'en' | 'ar' = 'en') =>
  renderWithProviders(
    <LocalizationProvider currency={site.currency} locales={site.locales}>
      <SectionList site={site} />
    </LocalizationProvider>,
    { locale },
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the section registry (ADR 0023)', () => {
  it('has a renderer for every section type', () => {
    expect(Object.keys(SECTION_RENDERERS).sort()).toEqual([...WEBSITE_SECTION_TYPES].sort());
  });

  it('shows enabled sections in their order and skips disabled ones', async () => {
    const hidden = { ...hero(5, 'Hidden'), enabled: false };
    await render(siteWith([hero(20, 'Second'), hidden, hero(10, 'First')]));
    const headings = screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent);
    expect(headings).toEqual(['First', 'Second']);
    expect(visibleSections([hero(2, 'b'), hidden, hero(1, 'a')]).map((s) => s.id)).toEqual([
      'hero-1',
      'hero-2',
    ]);
  });

  it('renders every type of section from MADAR’s starting content', async () => {
    serveMenu();
    const sections = WEBSITE_SECTION_TYPES.map((type, index) =>
      blankSection(type, `s-${String(index)}`, index),
    );
    const { container } = await render(siteWith(sections));
    const rendered = [...container.querySelectorAll('[data-section-type]')].map((el) =>
      el.getAttribute('data-section-type'),
    );
    // A gallery and testimonials with nothing in them stay out of the page.
    expect(rendered).toEqual(
      expect.arrayContaining(
        WEBSITE_SECTION_TYPES.filter(
          (t) =>
            t !== WebsiteSectionType.GALLERY &&
            t !== WebsiteSectionType.TESTIMONIALS &&
            t !== WebsiteSectionType.FEATURED_PRODUCTS &&
            t !== WebsiteSectionType.CATEGORIES,
        ),
      ),
    );
    // The menu sections appear once the branch's menu has loaded.
    expect(await screen.findAllByTestId('featured-product')).toHaveLength(2);
    expect(await screen.findByRole('link', { name: /Mains/ })).toHaveAttribute(
      'href',
      `/l/${location.id}#cat-${id(70)}`,
    );
  });

  it('speaks the visitor’s language, falling back to the store’s default', async () => {
    await render(
      siteWith([hero(0, 'Fresh bread', 'خبز طازج'), hero(1, 'English only')], {
        locales: { default: 'en', supported: ['en', 'ar'], digits: 'latn', sources: {} } as never,
      }),
      'ar',
    );
    const headings = screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent);
    expect(headings).toEqual(['خبز طازج', 'English only']);
  });

  it('draws the appearance from design tokens and opens outside links safely', async () => {
    const section = hero(0, 'Welcome');
    section.appearance = { background: SectionBackground.PRIMARY, alignment: 'CENTER' };
    section.content.cta = {
      label: { en: 'Instagram' },
      href: 'https://instagram.com/demo',
    };
    const { container } = await render(siteWith([section]));
    const frame = container.querySelector('#hero-0');
    expect(frame).toHaveClass('bg-primary', 'text-primary-foreground', 'text-center');
    const link = within(frame as HTMLElement).getByRole('link', { name: 'Instagram' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('lists the store’s branches with the way to their menus', async () => {
    await render(siteWith([blankSection(WebsiteSectionType.LOCATIONS, 'branches', 0)]));
    expect(screen.getByRole('heading', { name: 'Our branches' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View menu · Main Branch' })).toHaveAttribute(
      'href',
      `/l/${location.id}`,
    );
  });
});
