/**
 * The platform's own brand (ADR 0019): the one place its names live. Translations, page titles,
 * the POS app's bundle and the admin's sidebar and login footers read it from here, and
 * `tools/brand.test.mjs` fails when a component, a translation or a page spells it out instead.
 *
 * A tenant's branding (its name, logo and colours) is configuration, not this.
 */
export const PLATFORM_BRAND = {
  /** The product, in Latin script (also used in Arabic text next to Latin product names). */
  name: 'MADAR',
  /** The product in Arabic script. */
  nameAr: 'مدار',
  /** The company behind the product: "MADAR · Powered by JudyTech". */
  company: 'JudyTech',
  /** What each app is called, in window titles and the POS app bundle. */
  products: {
    admin: 'MADAR Admin',
    pos: 'MADAR POS',
    kds: 'MADAR Kitchen',
    kiosk: 'MADAR Kiosk',
    /** The operators' console (ADR 0025). */
    platform: 'MADAR Platform',
    website: 'MADAR',
  },
  /** The POS desktop app (Tauri): bundle identifier and keychain service. */
  app: { identifier: 'app.madar.pos', keychainService: 'app.madar.pos' },
  /** Default assets, served by every app from its `public/` folder. */
  assets: { favicon: '/favicon.svg', logo: '/madar-logo.svg' },
} as const;

export type PlatformApp = keyof typeof PLATFORM_BRAND.products;

/**
 * Fills the brand placeholders of an app's `index.html` (`%PLATFORM_TITLE%`,
 * `%PLATFORM_FAVICON%`). Each app's Vite config runs it, so no page spells the brand out.
 */
export function brandIndexHtml(html: string, app: PlatformApp): string {
  return html
    .replaceAll('%PLATFORM_TITLE%', PLATFORM_BRAND.products[app])
    .replaceAll('%PLATFORM_FAVICON%', PLATFORM_BRAND.assets.favicon);
}
