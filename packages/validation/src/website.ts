import {
  DomainKind,
  DomainStatus,
  SectionAlignment,
  SectionBackground,
  SocialNetwork,
  WEBSITE_LIMITS,
  WebsiteSectionType,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { publicLocationSchema } from './online-ordering';
import { resolvedBrandingSchema } from './branding';
import { resolvedCurrencySchema, resolvedLocalesSchema } from './localization';

// --- Website configuration (ADR 0023) ------------------------------------------------------------

const shortText = z.string().trim().max(WEBSITE_LIMITS.shortText);
const longText = z.string().trim().max(WEBSITE_LIMITS.longText);

/**
 * Text in each language the tenant offers (ADR 0020). A missing language falls back to the
 * tenant's default, then to any language that has the text.
 */
export const localizedTextSchema = z
  .object({ en: shortText.optional(), ar: shortText.optional() })
  .strict();
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export const localizedLongTextSchema = z
  .object({ en: longText.optional(), ar: longText.optional() })
  .strict();

/**
 * Where a link may go: a section of the page (`#about`), a page of the site (`/track`) or an
 * outside page over HTTPS. Nothing else, so a link can never run script (`javascript:`).
 */
export const websiteHrefSchema = z
  .string()
  .trim()
  .max(300)
  .regex(
    /^(#[a-z0-9-]{1,40}|\/(?!\/)[A-Za-z0-9\-._~/?=&%#]*|https:\/\/[^\s"'<>]+)$/,
    'Use #section, /page or an https:// address',
  );

export const websiteLinkSchema = z
  .object({ label: localizedTextSchema, href: websiteHrefSchema })
  .strict();
export type WebsiteLink = z.infer<typeof websiteLinkSchema>;

export const sectionAppearanceSchema = z
  .object({
    background: z.enum(enumValues(SectionBackground)),
    alignment: z.enum(enumValues(SectionAlignment)),
  })
  .strict();
export type SectionAppearance = z.infer<typeof sectionAppearanceSchema>;

/** What every section has: its anchor id, whether it shows, its position and its look. */
const sectionBase = {
  /** Also the section's anchor (`#id`), so links can point at it. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Lower-case letters, digits and dashes'),
  enabled: z.boolean(),
  order: z.int().min(0).max(999),
  appearance: sectionAppearanceSchema,
};

const imageId = idSchema.nullable();

function section<T extends WebsiteSectionType, C extends z.ZodType>(type: T, content: C) {
  return z.object({ ...sectionBase, type: z.literal(type), content }).strict();
}

export const heroSectionSchema = section(
  WebsiteSectionType.HERO,
  z
    .object({
      title: localizedTextSchema,
      subtitle: localizedTextSchema,
      cta: websiteLinkSchema.nullable(),
      imageFileId: imageId,
    })
    .strict(),
);

/** Products of a location's published menu; none chosen = the first ones available. */
export const featuredProductsSectionSchema = section(
  WebsiteSectionType.FEATURED_PRODUCTS,
  z
    .object({
      title: localizedTextSchema,
      productIds: z.array(idSchema).max(WEBSITE_LIMITS.featuredProducts),
      /** The location whose menu (prices, availability) is shown; null = the first open one. */
      locationId: idSchema.nullable(),
    })
    .strict(),
);

/** Categories linking into the menu; none chosen = all of them. */
export const categoriesSectionSchema = section(
  WebsiteSectionType.CATEGORIES,
  z.object({ title: localizedTextSchema, categoryIds: z.array(idSchema).max(50) }).strict(),
);

export const aboutSectionSchema = section(
  WebsiteSectionType.ABOUT,
  z
    .object({ title: localizedTextSchema, body: localizedLongTextSchema, imageFileId: imageId })
    .strict(),
);

export const gallerySectionSchema = section(
  WebsiteSectionType.GALLERY,
  z
    .object({
      title: localizedTextSchema,
      images: z
        .array(z.object({ fileId: idSchema, caption: localizedTextSchema }).strict())
        .max(WEBSITE_LIMITS.galleryImages),
    })
    .strict(),
);

export const testimonialsSectionSchema = section(
  WebsiteSectionType.TESTIMONIALS,
  z
    .object({
      title: localizedTextSchema,
      items: z
        .array(z.object({ quote: localizedLongTextSchema, author: shortText.min(1) }).strict())
        .max(WEBSITE_LIMITS.testimonials),
    })
    .strict(),
);

/** The tenant's active locations, each with its ordering status and a link to its menu. */
export const locationsSectionSchema = section(
  WebsiteSectionType.LOCATIONS,
  z.object({ title: localizedTextSchema }).strict(),
);

export const contactSectionSchema = section(
  WebsiteSectionType.CONTACT,
  z
    .object({
      title: localizedTextSchema,
      phone: z
        .string()
        .trim()
        .regex(/^\+?[0-9 ()-]{6,20}$/)
        .nullable(),
      email: z.email().max(200).nullable(),
      address: localizedTextSchema,
    })
    .strict(),
);

/** Opening hours of one location (null = every location). */
export const openingHoursSectionSchema = section(
  WebsiteSectionType.OPENING_HOURS,
  z.object({ title: localizedTextSchema, locationId: idSchema.nullable() }).strict(),
);

export const promoBannerSectionSchema = section(
  WebsiteSectionType.PROMO_BANNER,
  z.object({ text: localizedTextSchema, cta: websiteLinkSchema.nullable() }).strict(),
);

/** The page's last block: the tenant's text, plus the navigation and social links. */
export const footerSectionSchema = section(
  WebsiteSectionType.FOOTER,
  z.object({ text: localizedTextSchema }).strict(),
);

export const websiteSectionSchema = z.discriminatedUnion('type', [
  heroSectionSchema,
  featuredProductsSectionSchema,
  categoriesSectionSchema,
  aboutSectionSchema,
  gallerySectionSchema,
  testimonialsSectionSchema,
  locationsSectionSchema,
  contactSectionSchema,
  openingHoursSectionSchema,
  promoBannerSectionSchema,
  footerSectionSchema,
]);
export type WebsiteSection = z.infer<typeof websiteSectionSchema>;
export type WebsiteSectionOf<T extends WebsiteSectionType> = Extract<WebsiteSection, { type: T }>;

export const socialLinkSchema = z
  .object({
    network: z.enum(enumValues(SocialNetwork)),
    url: z.url({ protocol: /^https$/ }).max(300),
  })
  .strict();
export type SocialLink = z.infer<typeof socialLinkSchema>;

export const websiteSeoSchema = z
  .object({
    /** The page title (the business's name when empty). */
    title: localizedTextSchema,
    /** The search-result and link-preview description. */
    description: localizedTextSchema,
    imageFileId: imageId,
  })
  .strict();

/** A whole website: the draft the admin edits, or the version published to visitors. */
export const websiteConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    navigation: z.array(websiteLinkSchema).max(WEBSITE_LIMITS.navigationLinks),
    social: z.array(socialLinkSchema).max(WEBSITE_LIMITS.socialLinks),
    seo: websiteSeoSchema,
    sections: z.array(websiteSectionSchema).max(WEBSITE_LIMITS.sections),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.sections.forEach((s, index) => {
      if (seen.has(s.id)) {
        ctx.addIssue({ code: 'custom', path: ['sections', index, 'id'], message: 'Duplicate id' });
      }
      seen.add(s.id);
    });
    if (config.sections.filter((s) => s.type === WebsiteSectionType.FOOTER).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'Only one footer' });
    }
  });
export type WebsiteConfig = z.infer<typeof websiteConfigSchema>;

/** Every tenant file a website shows (hero, about, gallery and preview images). */
export function websiteFileIds(config: WebsiteConfig): string[] {
  const ids = new Set<string>();
  if (config.seo.imageFileId) ids.add(config.seo.imageFileId);
  for (const s of config.sections) {
    switch (s.type) {
      case WebsiteSectionType.HERO:
      case WebsiteSectionType.ABOUT:
        if (s.content.imageFileId) ids.add(s.content.imageFileId);
        break;
      case WebsiteSectionType.GALLERY:
        for (const image of s.content.images) ids.add(image.fileId);
        break;
      default:
        break;
    }
  }
  return [...ids];
}

/** What the admin edits: the draft, and what visitors see now. */
export const websiteStateSchema = z.object({
  draft: websiteConfigSchema,
  /** Null until the first publication: visitors see the defaults. */
  published: websiteConfigSchema.nullable(),
  /** Increases with each publication (0 = never published). */
  version: z.int().min(0),
  publishedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
  /** Whether the draft differs from what visitors see. */
  hasUnpublishedChanges: z.boolean(),
});
export type WebsiteState = z.infer<typeof websiteStateSchema>;

/** A short-lived token that shows the draft on the tenant's own site. */
export const websitePreviewSchema = z.object({
  token: z.string(),
  expiresAt: isoDateTimeSchema,
  /** The tenant's primary site with the token, ready to open. */
  url: z.string(),
});
export type WebsitePreview = z.infer<typeof websitePreviewSchema>;

// --- Domains -----------------------------------------------------------------------------------

export const domainKindSchema = z.enum(enumValues(DomainKind));
export const domainStatusSchema = z.enum(enumValues(DomainStatus));

export const tenantDomainSchema = z.object({
  id: idSchema,
  domain: z.string(),
  /** Where a browser opens the site on this domain. */
  url: z.string(),
  kind: domainKindSchema,
  status: domainStatusSchema,
  isPrimary: z.boolean(),
  /** The TXT record to publish (custom domains; null for MADAR's own address). */
  verification: z
    .object({ type: z.literal('TXT'), name: z.string(), value: z.string() })
    .nullable(),
  verifiedAt: isoDateTimeSchema.nullable(),
  lastCheckedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type TenantDomainDto = z.infer<typeof tenantDomainSchema>;

export const addDomainSchema = z.object({ domain: z.string().trim().min(1).max(300) }).strict();

// --- The public site ---------------------------------------------------------------------------

/**
 * Everything the website shows about the tenant its host name resolved to (ADR 0023): no slug,
 * no other tenant, no draft unless a valid preview token asked for it.
 */
export const publicSiteSchema = z.object({
  id: idSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  /** How the store shows amounts (ADR 0020). */
  currency: resolvedCurrencySchema,
  /** The languages the store offers; the website starts in the default (ADR 0020). */
  locales: resolvedLocalesSchema,
  timezone: z.string(),
  locations: z.array(publicLocationSchema),
  /** The website's branding (surface `website`, ADR 0019); its files are public. */
  branding: resolvedBrandingSchema,
  /** The published website (or MADAR's defaults for the business), or the draft in a preview. */
  website: websiteConfigSchema,
  preview: z.boolean(),
  /** The tenant's primary domain (canonical address of the site). */
  primaryDomain: z.string(),
});
export type PublicSite = z.infer<typeof publicSiteSchema>;
