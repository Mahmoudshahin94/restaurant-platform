# Configuration

MADAR serves every tenant from one codebase. What differs between tenants (modules, branding,
theme, currency, languages, payment providers, devices) is **configuration**, never a fork, a
branch or an `if (businessType === …)` in a component. See the
[migration plan](madar/migration-plan.md).

## Precedence

Configuration is resolved in layers, from the least to the most specific. A more specific layer
overrides a less specific one, setting by setting:

```
Platform defaults          MADAR's defaults for every tenant
  ↓
Business-type defaults     what a RESTAURANT, SUPERMARKET, CLOTHING store… starts with
  ↓
Tenant configuration       the tenant's own choices
  ↓
Surface configuration      one screen (login, POS, KDS, kiosk, website) differing from the tenant
  ↓
Location configuration     one branch or store differing from the tenant
  ↓
Device configuration       one terminal, screen or kiosk differing from its location
```

- A layer that says nothing about a setting inherits it from the layer above. "Unset" is
  different from "off".
- **Platform entitlements cap the result.** For modules, the platform operator decides what a
  tenant may use (its subscription), and whether tenant administrators may change a module at all.
  A tenant, location or device cannot enable a module the tenant is not entitled to.
- The business type contributes **defaults only**. After provisioning, behaviour depends on the
  resolved capabilities (`isEnabled(Feature.KDS)`), never on the type.
- Resolution is one pure function in `@pos/domain` (`resolveLayered`), shared by the cloud, the
  location hub (offline) and the apps. Each resolved value carries the layer it came from, so the
  admin can show "inherited from: business type".

## What exists today

| Setting                                        | Layers today                                                                                                     | Phase |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| Business type, status, legal name              | tenant (type and status set by the platform)                                                                     | M1 ✅ |
| Default and supported locales, digit style     | platform → tenant (digits); tenant (locales)                                                                     | M4 ✅ |
| Currency                                       | tenant (fixed at provisioning, ADR 0002; ILS default)                                                            | M4 ✅ |
| Time zone, tax mode, cash rounding, KDS times  | tenant time zone; location settings                                                                              | ✅    |
| Modules (POS, KDS, TABLES, BARCODE, …)         | platform → business type → tenant → location → device                                                            | M2 ✅ |
| Branding and theme                             | platform → tenant → surface → device (theme mode)                                                                | M3 ✅ |
| Currency display (symbol, display, format)     | platform → tenant                                                                                                | M4 ✅ |
| Retail catalog (options, barcodes, stock flag) | modules (above); catalog data per tenant                                                                         | M5 ✅ |
| Self-service kiosks (terminals, card terminal) | modules (device layer from paired terminals); kiosk branding surface; installation (`PAYMENT_TERMINAL_PROVIDER`) | M6 ✅ |
| Website sections and domains                   | platform → business type (template) → tenant; installation (`PLATFORM_WEB_DOMAIN`, `DOMAIN_VERIFIER`)            | M7 ✅ |
| Payment providers                              | tenant → location                                                                                                | M8    |
| Release channel                                | platform → tenant                                                                                                | M10   |

Each phase's ADR records the exact settings it adds and the layers they accept.

## Modules (M2)

See [ADR 0018](adr/0018-feature-modules.md). The catalog is `Feature` in `@pos/shared-types`; the
defaults are in `packages/domain/src/features/defaults.ts`, the only file allowed to look at the
business type (lint rule `pos-local/no-business-type-branching`).

| Module             | Platform | Restaurant | Coffee shop | Supermarket, grocery | Clothing, retail | Enforced today                                               |
| ------------------ | -------- | ---------- | ----------- | -------------------- | ---------------- | ------------------------------------------------------------ |
| POS                | on       | on         | on          | on                   | on               | —                                                            |
| KDS                | off      | on         | on          | off                  | off              | kitchen routes, kitchen tickets, POS kitchen progress, KDS   |
| KITCHEN_PRINTER    | off      | on         | off         | off                  | off              | admin kitchen stations (with KDS)                            |
| ONLINE_ORDERING    | off      | on         | on          | off                  | off              | storefront, website orders, settings, admin page             |
| BARCODE            | off      | off        | off         | on                   | on               | codes in the menu, lookup route, POS scanning, admin codes   |
| INVENTORY          | off      | off        | off         | on                   | on               | admin stock flag only (the ledger is a later phase)          |
| TABLES             | off      | on         | off         | off                  | off              | floor routes, dine-in table rule, POS tables, admin tables   |
| MODIFIERS          | off      | on         | on          | off                  | off              | published menu, POS options dialog, admin modifier groups    |
| PRODUCT_VARIANTS   | off      | on         | off         | off                  | on               | option axes and the variant matrix (admin and API)           |
| DELIVERY           | off      | on         | off         | on                   | off              | —                                                            |
| SELF_CHECKOUT      | off      | off        | on          | on                   | off              | kiosk menu, orders and payments; kiosk app; POS kiosk orders |
| CUSTOMER_DISPLAY   | off      | off        | off         | on                   | on               | —                                                            |
| LOYALTY            | off      | off        | off         | on                   | on               | —                                                            |
| ADVANCED_REPORTING | off      | off        | off         | off                  | off              | —                                                            |

`OTHER` gets the platform defaults. Above the layers, the platform operator's entitlement per
tenant and module decides:

- `entitled`: without it the module is off everywhere.
- `tenantConfigurable`: without it the tenant, location and device layers are ignored.

A module without an entitlement row is entitled and configurable (until Phase M9 sells plans).

Where the layers are written:

| Layer         | Stored in                                     | Written by                                   |
| ------------- | --------------------------------------------- | -------------------------------------------- |
| Platform      | `PLATFORM_FEATURE_DEFAULTS` (code)            | MADAR releases                               |
| Business type | `BUSINESS_TYPE_DEFAULTS` (code)               | MADAR releases                               |
| Entitlement   | `tenant_entitlements`                         | the platform operator (seed today; M9 API)   |
| Tenant        | `feature_overrides` (`scope = tenant`)        | admin → Settings → Modules                   |
| Location      | `feature_overrides` (`scope = location:<id>`) | admin → Settings → Modules, per location     |
| Device        | `feature_overrides` (`scope = device:<id>`)   | `PUT /tenants/:tid/features/:f` (`deviceId`) |

The cloud and every location hub resolve with the same function from the same rows (the hub's
come with its snapshot), so a hub enforces modules offline. Apps read the result from
`GET /tenants/:tenantId/context?locationId=` (`useFeature`, `<FeatureGate>` in `@pos/app-kit`).
Since M6 the device layer applies to real devices: a paired terminal's requests name it, so a
kiosk's modules (`GET /kiosk/context`, its routes) include the overrides of that kiosk.

## Branding and theme (M3)

See [ADR 0019](adr/0019-branding-and-theme.md). Two brands, never confused:

- **The platform's** (MADAR · Powered by JudyTech): `PLATFORM_BRAND` in `@pos/shared-types`,
  the only place its names live. It is not configuration: it changes with releases.
- **The tenant's**: configuration, resolved by `resolveBranding` (`@pos/domain`) on the cloud, the
  hub and in the apps.

| Setting                                       | MADAR default      | Tenant | Surface | Device |
| --------------------------------------------- | ------------------ | ------ | ------- | ------ |
| Display name (EN, AR)                         | the tenant's names | ✓      | ✓       |        |
| Logo, favicon                                 | MADAR's assets     | ✓      | ✓       |        |
| Primary, secondary, accent colour (`#rrggbb`) | the theme's own    | ✓      | ✓       |        |
| Typeface (`INTER`, `SYSTEM`, `SERIF`)         | `INTER`            | ✓      | ✓       |        |
| Logo size (`SMALL`, `MEDIUM`, `LARGE`)        | `MEDIUM`           | ✓      | ✓       |        |
| Theme mode (`LIGHT`, `DARK`, `SYSTEM`)        | `DARK`             | ✓      | ✓       | ✓      |
| Surface style (`SOLID`, `GLASS`)              | `SOLID`            | ✓      | ✓       |        |
| Corner radius (0–24 px)                       | 8                  | ✓      | ✓       |        |

- **Surfaces** are `login` (the POS and KDS sign-in screens, served by the hub), `pos`, `kds`,
  `kiosk` (the self-service kiosk, M6) and `website`. The admin has no surface: it shows the
  tenant's defaults.
- **The device layer** is a screen's own light/dark choice (Appearance, kept in the browser or
  the POS app), and wins over the tenant's. It is not stored in the cloud. A kiosk keeps no choice
  of its own: its surface's theme applies.
- **Readability is enforced:** text on every brand colour reaches WCAG AA, and primary and accent
  reach 3:1 against the page of both themes (any device may choose either). Unreadable colours
  are refused when saved (`BRANDING_UNREADABLE`) and flagged in the admin as they are typed.

Where the layers are written:

| Layer    | Stored in                           | Written by                                   |
| -------- | ----------------------------------- | -------------------------------------------- |
| Platform | `PLATFORM_BRANDING_DEFAULTS` (code) | MADAR releases                               |
| Tenant   | `tenant_branding` columns           | admin → Settings → Branding                  |
| Surface  | `tenant_branding.surfaces` (JSON)   | admin → Settings → Branding → Screens        |
| Device   | the device's local storage          | Appearance, on each screen (`ThemeSwitcher`) |

Logos and favicons are tenant files (`tenant_files` and the tenant file storage). Branding and the
files it shows reach every hub of the tenant through the change feed and the snapshot, so a hub
shows the tenant's look offline. Apps read branding from
`GET /tenants/:tenantId/context?surface=` (`ThemeProvider`, `TenantLogo` in `@pos/app-kit`);
the website and the sign-in screens read the public branding of the storefront and of the hub.

## Currency and languages (M4)

See [ADR 0020](adr/0020-currency-and-localization.md). The currency itself is not a setting: it is
chosen when the tenant is provisioned (ILS unless the platform operator chooses another) and every
amount is stored in its minor units ([ADR 0002](adr/0002-money-integer-minor-units.md)). How amounts
look, and which languages the screens offer, are:

| Setting                                    | MADAR default                     | Tenant | Notes                                            |
| ------------------------------------------ | --------------------------------- | ------ | ------------------------------------------------ |
| Decimal places                             | ISO 4217 of the currency          |        | read-only: 2 for ILS, USD, EUR, GBP; 3 for JOD   |
| Symbol                                     | `₪` for ILS, else `Intl`'s symbol | ✓      | 1–8 characters, no digits or control marks       |
| Display (`narrowSymbol`, `symbol`, `code`) | `narrowSymbol`                    | ✓      | the code display ignores the symbol              |
| Format locale (`FORMAT_LOCALES`)           | none: the screen's language       | ✓      | e.g. `de-DE` writes `1.234,56 €` on every screen |
| Supported locales                          | English and Arabic                | ✓      | at least one; one language hides the switcher    |
| Default locale                             | `en`                              | ✓      | always among the supported                       |
| Digits in Arabic (`latn`, `arab`)          | `latn` (0–9)                      | ✓      | English is always written in 0–9                 |

- `resolveCurrency` and `resolveLocales` (`@pos/domain`) resolve them on the cloud, the hub and in
  the apps; every display setting and the digit style name their layer.
- **Which language a screen shows:** the device's stored choice if the tenant offers it, else the
  signed-in user's preferred locale if offered, else the tenant's default (`selectLocale`). The
  website has no user: the visitor's choice, else the store's default.

Where the layers are written:

| Layer    | Stored in                                                                                                                            | Written by                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Platform | `PLATFORM_CURRENCY_SYMBOLS`, `PLATFORM_CURRENCY_DISPLAY`, `PLATFORM_DIGIT_STYLE`                                                     | MADAR releases                           |
| Tenant   | `tenants` columns (`currency_symbol`, `currency_display`, `currency_format_locale`, `supported_locales`, `default_locale`, `digits`) | admin → Settings → Language and currency |

They ride the tenant row, so the change feed and the snapshot bring them to every hub. Apps read
them from `GET /tenants/:tenantId/context` (`useMoneyFormat`, `useFormatOptions`,
`LanguageSwitcher` in `@pos/app-kit`); the website from `GET /public/site` (its host's tenant, M7); the hub's
sign-in screens from `GET /hub/locales`.

## Retail catalog (M5)

See [ADR 0021](adr/0021-retail-catalog-and-barcodes.md). The catalog itself is tenant data, not
configuration; the modules decide what of it a tenant uses, resolved like any module (platform →
business type → tenant → location → device):

| Module             | What it turns on                                                                              | Without it                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PRODUCT_VARIANTS` | option axes on products and the generated variant matrix                                      | sizes named by hand still work; stored options stay editable                                         |
| `BARCODE`          | product and variant codes, the lookup route, codes in the menu, POS scanning and manual entry | `403 FEATURE_DISABLED` on new codes and the lookup; the menu has no codes, so nothing can be scanned |
| `INVENTORY`        | the per-variant "count stock" flag (`trackInventory`)                                         | the flag is hidden in the admin; nothing counts stock yet                                            |

`BARCODE` is resolved for the location (the lookup route, the menu, the POS) and for the tenant
(writing codes). The scanner's timing (`maxKeyIntervalMs` 35, `minLength` 4, terminator Enter)
is code today (`KEYBOARD_WEDGE_DEFAULTS`), not yet a device setting. The demo restaurant switches
`BARCODE` on in its seed file (`features`), so its colas can be scanned.

## Self-service kiosk (M6)

See [ADR 0022](adr/0022-self-service-kiosk.md). The kiosk adds no setting of its own to the
layers: what it offers follows the modules, resolved for its location **and the kiosk itself**
(the device layer, now fed by paired terminals), and it looks like the tenant's `kiosk` surface.

| What                                      | Decided by                                                             | Where it is written                                  |
| ----------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Whether a kiosk sells at all              | `SELF_CHECKOUT` (business type → tenant → location → device)           | admin → Settings → Modules; a device override by API |
| Paid order to the kitchen, or handed over | `KDS` at the location: tickets where on; COMPLETED at once where off   | the same modules                                     |
| Scanning items                            | `BARCODE` (the menu carries codes only with it)                        | the same modules                                     |
| Modifier choices                          | `MODIFIERS`                                                            | the same modules                                     |
| Look                                      | branding, `kiosk` surface over the tenant's                            | admin → Settings → Branding → Screens                |
| Languages, money                          | the tenant's (M4); the customer may switch for the visit               | admin → Settings → Language and currency             |
| Leaving the customer screens              | the `kiosk.attend` permission at the kiosk's location                  | admin → Staff → Roles                                |
| Card terminal adapter                     | `PAYMENT_TERMINAL_PROVIDER` (`none`, `mock`; installation, not tenant) | the hub's environment (`mock` refused in production) |

Code, not yet settings: the pairing code's lifetime (24 h), the idle reset (60 s, then 15 s to
answer), the order-number screen (20 s), and how often a terminal's contact is reported to the
cloud (every 5 min; a new app version at once).

## Tenant websites (M7)

See [ADR 0023](adr/0023-multi-tenant-website.md). A tenant's website is one configuration (its
sections, navigation, social links and SEO) plus the domains it answers on. The page's colours,
logo and names stay the branding's `website` surface (M3); its languages and money stay M4's.

| What                                         | Decided by                                                                              | Where it is written                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Whether the tenant has a website at all      | `ONLINE_ORDERING` (business type → tenant → location)                                   | admin → Settings → Modules                          |
| The pages before the tenant publishes        | MADAR's template for the business type (`defaultWebsiteConfig`: food or shop wording)   | code (`@pos/validation`, looked up, never compared) |
| Sections, order, texts, pictures, appearance | the tenant: a draft, then published versions                                            | admin → Website → Website editor (`website.manage`) |
| Navigation, social links, SEO                | the tenant, with the sections                                                           | the same editor                                     |
| Texts in each language                       | the tenant's supported locales (M4); a missing text falls back to the default language  | the same editor                                     |
| MADAR's address of the site                  | `<slug>.<PLATFORM_WEB_DOMAIN>`, created at provisioning                                 | installation (`PLATFORM_WEB_DOMAIN`)                |
| Custom domains, primary domain               | the tenant, after DNS verification (`_madar-verify.<domain>` TXT record)                | admin → Website → Domains (`website.manage`)        |
| How domains are verified                     | `DOMAIN_VERIFIER` (`dns`; `mock` for development and tests, refused in production)      | the API's environment                               |
| The development tenant on bare `localhost`   | `DEV_DEFAULT_TENANT_SLUG` (refused in production; never applies to a domain)            | the API's environment                               |
| Where a browser opens a site                 | `WEBSITE_URL` (`http://{domain}:5175` in development, `https://{domain}` in production) | the API's environment                               |
| `X-Forwarded-Host`                           | read only behind a trusted proxy (`TRUST_PROXY`, ADR 0016)                              | the API's environment                               |

Code, not yet settings: the preview link's lifetime (30 min), at most 5 custom domains, 30
sections, 12 pictures in a gallery, 12 testimonials and 12 featured products, and text lengths
(120 characters, 2,000 for long texts).
