import {
  type BusinessType,
  SectionAlignment,
  SectionBackground,
  WebsiteSectionType,
} from '@pos/shared-types';
import type { LocalizedText, WebsiteConfig, WebsiteSection, WebsiteSectionOf } from './website';

/**
 * MADAR's starting website for each kind of business (ADR 0023): what a tenant's site shows until
 * it publishes its own, and the draft its editor starts from. The colours, logo and names come
 * from the tenant's branding at render time, so they are not copied here. The business type only
 * picks a template (looked up, never compared: ADR 0018).
 */

type Template = 'FOOD' | 'SHOP';

const TEMPLATE_BY_BUSINESS_TYPE: Readonly<Record<BusinessType, Template>> = {
  RESTAURANT: 'FOOD',
  COFFEE_SHOP: 'FOOD',
  SUPERMARKET: 'SHOP',
  GROCERY: 'SHOP',
  CLOTHING: 'SHOP',
  RETAIL: 'SHOP',
  OTHER: 'SHOP',
};

const text = (en: string, ar: string): LocalizedText => ({ en, ar });

interface Copy {
  heroTitle: LocalizedText;
  heroSubtitle: LocalizedText;
  heroCta: LocalizedText;
  featured: LocalizedText;
  categories: LocalizedText;
  about: LocalizedText;
  aboutBody: LocalizedText;
}

const COPY: Record<Template, Copy> = {
  FOOD: {
    heroTitle: text('Fresh, made to order', 'طازج ومحضّر حسب الطلب'),
    heroSubtitle: text(
      'Order online for pickup or delivery from your nearest branch.',
      'اطلب عبر الإنترنت للاستلام أو التوصيل من أقرب فرع.',
    ),
    heroCta: text('Order now', 'اطلب الآن'),
    featured: text('Popular right now', 'الأكثر طلبًا'),
    categories: text('Our menu', 'قائمتنا'),
    about: text('About us', 'من نحن'),
    aboutBody: text(
      'We cook with fresh ingredients every day. Order ahead and we will have it ready.',
      'نطبخ بمكونات طازجة كل يوم. اطلب مسبقًا وسنجهّز طلبك.',
    ),
  },
  SHOP: {
    heroTitle: text('Shop with us', 'تسوّق معنا'),
    heroSubtitle: text(
      'Browse our products and order from the store near you.',
      'تصفّح منتجاتنا واطلب من المتجر الأقرب إليك.',
    ),
    heroCta: text('Start shopping', 'ابدأ التسوق'),
    featured: text('Featured products', 'منتجات مميزة'),
    categories: text('Shop by department', 'تسوّق حسب القسم'),
    about: text('About the store', 'عن المتجر'),
    aboutBody: text(
      'Quality products at fair prices, with friendly service in every branch.',
      'منتجات عالية الجودة بأسعار عادلة وخدمة ودودة في كل فرع.',
    ),
  },
};

const appearance = (background: SectionBackground = SectionBackground.DEFAULT) => ({
  background,
  alignment: SectionAlignment.START,
});

/** A new section of `type`, with MADAR's wording, for the editor's "add section". */
export function blankSection(type: WebsiteSectionType, id: string, order: number): WebsiteSection {
  const base = { id, enabled: true, order, appearance: appearance() };
  const copy = COPY.SHOP;
  switch (type) {
    case WebsiteSectionType.HERO:
      return {
        ...base,
        type,
        appearance: { background: SectionBackground.PRIMARY, alignment: SectionAlignment.CENTER },
        content: {
          title: copy.heroTitle,
          subtitle: copy.heroSubtitle,
          cta: { label: copy.heroCta, href: '#locations' },
          imageFileId: null,
        },
      };
    case WebsiteSectionType.FEATURED_PRODUCTS:
      return { ...base, type, content: { title: copy.featured, productIds: [], locationId: null } };
    case WebsiteSectionType.CATEGORIES:
      return { ...base, type, content: { title: copy.categories, categoryIds: [] } };
    case WebsiteSectionType.ABOUT:
      return {
        ...base,
        type,
        content: { title: copy.about, body: copy.aboutBody, imageFileId: null },
      };
    case WebsiteSectionType.GALLERY:
      return { ...base, type, content: { title: text('Gallery', 'معرض الصور'), images: [] } };
    case WebsiteSectionType.TESTIMONIALS:
      return {
        ...base,
        type,
        content: { title: text('What our customers say', 'ماذا يقول عملاؤنا'), items: [] },
      };
    case WebsiteSectionType.LOCATIONS:
      return { ...base, type, content: { title: text('Our branches', 'فروعنا') } };
    case WebsiteSectionType.CONTACT:
      return {
        ...base,
        type,
        appearance: appearance(SectionBackground.MUTED),
        content: { title: text('Contact us', 'تواصل معنا'), phone: null, email: null, address: {} },
      };
    case WebsiteSectionType.OPENING_HOURS:
      return {
        ...base,
        type,
        content: { title: text('Opening hours', 'ساعات العمل'), locationId: null },
      };
    case WebsiteSectionType.PROMO_BANNER:
      return {
        ...base,
        type,
        appearance: { background: SectionBackground.PRIMARY, alignment: SectionAlignment.CENTER },
        content: { text: text('Order online today', 'اطلب عبر الإنترنت اليوم'), cta: null },
      };
    case WebsiteSectionType.FOOTER:
      return {
        ...base,
        type,
        appearance: appearance(SectionBackground.MUTED),
        content: { text: {} },
      };
  }
}

function withCopy<T extends WebsiteSectionType>(
  section: WebsiteSection,
  _type: T,
  content: Partial<WebsiteSectionOf<T>['content']>,
): WebsiteSection {
  return { ...section, content: { ...section.content, ...content } } as WebsiteSection;
}

/** The website a tenant starts with, for its business type (an unknown type gets the shop). */
export function defaultWebsiteConfig(businessType: string): WebsiteConfig {
  const template = Object.hasOwn(TEMPLATE_BY_BUSINESS_TYPE, businessType)
    ? TEMPLATE_BY_BUSINESS_TYPE[businessType as BusinessType]
    : 'SHOP';
  const copy = COPY[template];
  const order: WebsiteSectionType[] = [
    WebsiteSectionType.HERO,
    WebsiteSectionType.FEATURED_PRODUCTS,
    WebsiteSectionType.CATEGORIES,
    WebsiteSectionType.ABOUT,
    WebsiteSectionType.LOCATIONS,
    WebsiteSectionType.OPENING_HOURS,
    WebsiteSectionType.CONTACT,
    WebsiteSectionType.FOOTER,
  ];
  const ids: Record<string, string> = {
    HERO: 'hero',
    FEATURED_PRODUCTS: 'featured',
    CATEGORIES: 'categories',
    ABOUT: 'about',
    LOCATIONS: 'locations',
    OPENING_HOURS: 'hours',
    CONTACT: 'contact',
    FOOTER: 'footer',
  };
  const sections = order.map((type, index) => {
    const section = blankSection(type, ids[type] ?? type.toLowerCase(), index * 10);
    switch (section.type) {
      case WebsiteSectionType.HERO:
        return withCopy(section, section.type, {
          title: copy.heroTitle,
          subtitle: copy.heroSubtitle,
          cta: { label: copy.heroCta, href: '#locations' },
        });
      case WebsiteSectionType.FEATURED_PRODUCTS:
        return withCopy(section, section.type, { title: copy.featured });
      case WebsiteSectionType.CATEGORIES:
        return withCopy(section, section.type, { title: copy.categories });
      case WebsiteSectionType.ABOUT:
        return withCopy(section, section.type, {
          title: copy.about,
          body: copy.aboutBody,
        });
      default:
        return section;
    }
  });
  return {
    schemaVersion: 1,
    navigation: [
      { label: text('Menu', 'القائمة'), href: '#categories' },
      { label: text('Branches', 'الفروع'), href: '#locations' },
      { label: text('Contact', 'تواصل'), href: '#contact' },
    ],
    social: [],
    seo: { title: {}, description: copy.heroSubtitle, imageFileId: null },
    sections,
  };
}
