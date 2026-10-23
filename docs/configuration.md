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

| Setting                                       | Layers today                                          | Phase |
| --------------------------------------------- | ----------------------------------------------------- | ----- |
| Business type, status, legal name             | tenant (type and status set by the platform)          | M1 ✅ |
| Default and supported locales                 | tenant                                                | M1 ✅ |
| Currency                                      | tenant (fixed at provisioning, ADR 0002)              | M1 ✅ |
| Time zone, tax mode, cash rounding, KDS times | tenant time zone; location settings                   | ✅    |
| Modules (POS, KDS, TABLES, BARCODE, …)        | platform → business type → tenant → location → device | M2 ✅ |
| Branding and theme                            | platform → tenant → surface → device (theme mode)     | M3 ✅ |
| Currency display (symbol, format locale)      | platform → tenant                                     | M4    |
| Website sections and domains                  | tenant                                                | M7    |
| Payment providers                             | tenant → location                                     | M8    |
| Release channel                               | platform → tenant                                     | M10   |

Each phase's ADR records the exact settings it adds and the layers they accept.

## Modules (M2)

See [ADR 0018](adr/0018-feature-modules.md). The catalog is `Feature` in `@pos/shared-types`; the
defaults are in `packages/domain/src/features/defaults.ts`, the only file allowed to look at the
business type (lint rule `pos-local/no-business-type-branching`).

| Module             | Platform | Restaurant | Coffee shop | Supermarket, grocery | Clothing, retail | Enforced today                                             |
| ------------------ | -------- | ---------- | ----------- | -------------------- | ---------------- | ---------------------------------------------------------- |
| POS                | on       | on         | on          | on                   | on               | —                                                          |
| KDS                | off      | on         | on          | off                  | off              | kitchen routes, kitchen tickets, POS kitchen progress, KDS |
| KITCHEN_PRINTER    | off      | on         | off         | off                  | off              | admin kitchen stations (with KDS)                          |
| ONLINE_ORDERING    | off      | on         | on          | off                  | off              | storefront, website orders, settings, admin page           |
| BARCODE            | off      | off        | off         | on                   | on               | Phase M5                                                   |
| INVENTORY          | off      | off        | off         | on                   | on               | Phase M5                                                   |
| TABLES             | off      | on         | off         | off                  | off              | floor routes, dine-in table rule, POS tables, admin tables |
| MODIFIERS          | off      | on         | on          | off                  | off              | published menu, POS options dialog, admin modifier groups  |
| PRODUCT_VARIANTS   | off      | on         | off         | off                  | on               | Phase M5                                                   |
| DELIVERY           | off      | on         | off         | on                   | off              | —                                                          |
| SELF_CHECKOUT      | off      | off        | on          | on                   | off              | Phase M6                                                   |
| CUSTOMER_DISPLAY   | off      | off        | off         | on                   | on               | —                                                          |
| LOYALTY            | off      | off        | off         | on                   | on               | —                                                          |
| ADVANCED_REPORTING | off      | off        | off         | off                  | off              | —                                                          |

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
  `kiosk` (Phase M6) and `website`. The admin has no surface: it shows the tenant's defaults.
- **The device layer** is a screen's own light/dark choice (Appearance, kept in the browser or
  the POS app), and wins over the tenant's. Staff devices have no server-side identity yet, so it
  is not stored in the cloud.
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
