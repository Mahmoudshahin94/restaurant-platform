/**
 * The tenant's website (ADR 0023): the domains it answers on and the sections it shows. Domains
 * and statuses are stored as text by the cloud, so the lists below are the whole vocabulary.
 */

type ValueOf<T> = T[keyof T];

/** `SUBDOMAIN`: `<slug>.<PLATFORM_WEB_DOMAIN>`, created with the tenant. `CUSTOM`: the tenant's own. */
export const DomainKind = {
  SUBDOMAIN: 'SUBDOMAIN',
  CUSTOM: 'CUSTOM',
} as const;
export type DomainKind = ValueOf<typeof DomainKind>;
export const DOMAIN_KINDS = Object.values(DomainKind) as readonly DomainKind[];

/** Only `VERIFIED` domains serve the website (and get a certificate). */
export const DomainStatus = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  DISABLED: 'DISABLED',
} as const;
export type DomainStatus = ValueOf<typeof DomainStatus>;
export const DOMAIN_STATUSES = Object.values(DomainStatus) as readonly DomainStatus[];

/** A custom domain proves its owner with a TXT record at `_madar-verify.<domain>`. */
export const DOMAIN_VERIFICATION_LABEL = '_madar-verify';
/** The TXT record's value is `madar-verify=<token>`. */
export const DOMAIN_VERIFICATION_PREFIX = 'madar-verify=';
/** Custom domains a tenant may add (verified or not). */
export const MAX_CUSTOM_DOMAINS = 5;

/** The building blocks of a website page, rendered in their `order`. */
export const WebsiteSectionType = {
  HERO: 'HERO',
  FEATURED_PRODUCTS: 'FEATURED_PRODUCTS',
  CATEGORIES: 'CATEGORIES',
  ABOUT: 'ABOUT',
  GALLERY: 'GALLERY',
  TESTIMONIALS: 'TESTIMONIALS',
  LOCATIONS: 'LOCATIONS',
  CONTACT: 'CONTACT',
  OPENING_HOURS: 'OPENING_HOURS',
  PROMO_BANNER: 'PROMO_BANNER',
  FOOTER: 'FOOTER',
} as const;
export type WebsiteSectionType = ValueOf<typeof WebsiteSectionType>;
export const WEBSITE_SECTION_TYPES = Object.values(
  WebsiteSectionType,
) as readonly WebsiteSectionType[];

/** How a section is laid out: its background and its alignment. */
export const SectionBackground = {
  DEFAULT: 'DEFAULT',
  MUTED: 'MUTED',
  PRIMARY: 'PRIMARY',
} as const;
export type SectionBackground = ValueOf<typeof SectionBackground>;
export const SECTION_BACKGROUNDS = Object.values(SectionBackground) as readonly SectionBackground[];

export const SectionAlignment = {
  START: 'START',
  CENTER: 'CENTER',
} as const;
export type SectionAlignment = ValueOf<typeof SectionAlignment>;
export const SECTION_ALIGNMENTS = Object.values(SectionAlignment) as readonly SectionAlignment[];

/** Social networks a footer can link to (an icon each; nothing else is accepted). */
export const SocialNetwork = {
  FACEBOOK: 'FACEBOOK',
  INSTAGRAM: 'INSTAGRAM',
  X: 'X',
  TIKTOK: 'TIKTOK',
  WHATSAPP: 'WHATSAPP',
  YOUTUBE: 'YOUTUBE',
} as const;
export type SocialNetwork = ValueOf<typeof SocialNetwork>;
export const SOCIAL_NETWORKS = Object.values(SocialNetwork) as readonly SocialNetwork[];

/** Limits of a website's configuration (checked by its schema). */
export const WEBSITE_LIMITS = {
  sections: 30,
  galleryImages: 12,
  testimonials: 12,
  featuredProducts: 12,
  navigationLinks: 8,
  socialLinks: 8,
  shortText: 120,
  longText: 2000,
} as const;
