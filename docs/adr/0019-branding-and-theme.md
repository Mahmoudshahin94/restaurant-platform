# ADR 0019: Branding is configuration on semantic design tokens, and the platform's brand has one source

- Status: Accepted (2026-10-23)

## Context

After M1 and M2 ([ADR 0017](0017-tenant-root-and-isolation.md),
[ADR 0018](0018-feature-modules.md)) every tenant is its own business with its own modules, but
every screen still looks the same and still carries the old product's name ("Restaurant
Platform", the POS app "Tenant POS"). MADAR needs two kinds of brand, and they must not be
confused:

- **The platform's brand**: MADAR · Powered by JudyTech. It names the products (MADAR POS, MADAR
  Admin…) and appears on the sign-in screens and in the admin. It changes with releases, never
  per tenant, and it was spelled out in translations, page titles and the POS bundle.
- **The tenant's brand**: its name, logo, colours and look on the screens it runs and on its
  website. It is configuration, resolved like modules
  ([configuration.md](../configuration.md)), and it must reach a location hub that is offline.

Three constraints shaped the design:

- Colours were "almost fully tokenized" in one theme file, but dark mode existed only as a
  `.dark` class that the KDS forced on. A tenant colour written into that file's variables would
  reach most screens, but light and dark need different neutrals, and some brand colours are
  unreadable on one of them.
- Logos are files: the platform had no file storage, so no tenant isolation for files either
  (ADR 0017 deferred it to this phase).
- A logo is user-supplied content shown on public pages. An SVG can carry script.

## Decision

### The platform's brand has one source

`PLATFORM_BRAND` (`@pos/shared-types`, `brand.ts`) holds the names (Latin and Arabic), the
company, the product name of each app, the POS app's bundle identifier and keychain service
(`app.madar.pos`), and the default assets.

- Translations get `common:appName` and `common:platform.*` injected from it (`resources.ts`), and
  strings that name the platform nest `$t(common:platform.name)`.
- Every app's `index.html` has `%PLATFORM_TITLE%` and `%PLATFORM_FAVICON%`, filled by a Vite plugin
  (`brandIndexHtml`); at run time the title becomes "tenant · product".
- The Tauri bundle is "MADAR POS", `app.madar.pos`; its keychain service follows.
- `tools/brand/brand.test.mjs` fails when code, a translation or a page spells the brand (or the
  old names) out, and when the Tauri bundle drifts from `PLATFORM_BRAND`.

### Tenant branding is configuration

`TenantBranding` (one row per tenant, absent until saved):

| Setting                                         | Values                          | MADAR default           |
| ----------------------------------------------- | ------------------------------- | ----------------------- |
| `displayNameEn`, `displayNameAr`                | text                            | the tenant's names      |
| `logoFileId`, `faviconFileId`                   | a tenant file of the right kind | none (platform assets)  |
| `primaryColor`, `secondaryColor`, `accentColor` | `#rrggbb`                       | the theme's own colours |
| `fontFamily`                                    | `INTER`, `SYSTEM`, `SERIF`      | `INTER`                 |
| `logoSize`                                      | `SMALL`, `MEDIUM`, `LARGE`      | `MEDIUM`                |
| `themeMode`                                     | `LIGHT`, `DARK`, `SYSTEM`       | `DARK`                  |
| `surfaceStyle`                                  | `SOLID`, `GLASS`                | `SOLID`                 |
| `borderRadius`                                  | 0–24 px                         | 8                       |

- **Per-surface overrides** (`login`, `pos`, `kds`, `kiosk`, `website`) are one JSON column,
  validated by `surfaceOverridesSchema` (unknown surfaces or settings are refused). A surface sets
  only what differs; empty values are not stored.
- **Resolution** is `resolveBranding` (`@pos/domain`), built on `resolveLayered`: platform →
  tenant → surface → device. `SURFACE` is a new configuration layer, between the tenant and the
  location. The device layer is the screen's own light/dark choice, applied in the app
  (`withDeviceThemeMode`), because staff devices have no server-side identity yet (M6/M10).
  Every value names its layer, as for modules.
- Typefaces are a closed list, never a free font name: nothing a tenant enters becomes CSS other
  than a validated `#rrggbb`.

### Readable by construction

`brandingContrastIssues` (`@pos/domain`) runs in the admin as the tenant types and in the API at
save time (`422 BRANDING_UNREADABLE`, each issue with its path, the ratio and what it was checked
against):

- Text on each brand colour must reach WCAG AA (4.5:1). The foreground is chosen per colour:
  white or black, whichever contrasts more. With pure black and white every colour passes with
  one of them (a softer pair, such as an off-black, leaves a band of mid-tones unreadable), so
  this check refuses nothing today and guards the rule if the foregrounds ever change.
- Primary and accent are drawn on the page itself (links, outlines, selected states, the focus
  ring). They must reach 3:1 (WCAG non-text contrast) against the page of **both** themes, because
  any device may choose light or dark. This refuses near-black and near-white primaries and very
  light yellows; common brand blues, greens, reds, teals and purples pass.
- The theme's page colours are declared in `@pos/domain` (`THEME_BACKGROUNDS`) and in
  `theme.css`; a test keeps them equal. Another test checks every foreground/background token
  pair at AA in both themes.

### Semantic design tokens, three theme modes

`packages/ui/src/styles/theme.css` declares semantic tokens only (background, card, muted,
border, input, ring, overlay; primary, secondary, accent, destructive, success and warning with
their foregrounds; radii; typeface):

- `data-theme="dark"` (also with no attribute) is the default: a charcoal palette with soft
  borders, a restrained glow of the primary colour behind the page and high contrast.
- `data-theme="light"`, and `data-theme="system"`, which follows `prefers-color-scheme` in CSS.
  The light palette is written twice (light, and system on a light OS) and the dark one twice
  (the default, and `[data-theme=dark]` for a dark element in a light page, such as the admin's
  preview). Tests keep the copies equal.
- `data-surface="glass"` turns the `surface` utility (cards, panels, shell headers) translucent
  and frosted; text contrast holds because the surface keeps 78% of its colour over a page of
  nearly the same lightness.
- The `dark:` variant follows the same three modes.
- **`pos-local/no-raw-colors`** refuses Tailwind palette classes, arbitrary colour classes and
  colour literals in app and package code. The token files and printed receipts (black on white
  paper) are exempt; so are tests.

In `@pos/app-kit`:

- `applyTenantTheme(branding)` writes the tenant's colours with their computed foregrounds, the
  ring, the radii and the typeface as inline variables on `<html>`, plus `data-surface`. A colour
  the tenant left unset is not written, so light and dark keep their own.
- `ThemeProvider` (per app, with its surface) sets `data-theme` from the device's choice
  (`localStorage`), else the branding's, else MADAR's default; applies the branding registered by
  `TenantProvider` (or `useApplyBranding`), the favicon and the page title; and restores MADAR's
  look when the branding goes away. `applyStoredThemeMode()` runs before the first render, so a
  light device never flashes dark. `TenantLogo`, `ThemeSwitcher` and `PlatformFooter` render it.
- The KDS no longer forces `class="dark"`: dark is simply the default, and a kitchen can choose.

### Tenant files

- **`TenantFileStorage`** (`@pos/server`): `put`, `get`, `has`, each naming its tenant. Keys are
  `tenants/<tenantId>/<kind>/<fileId>.<ext>`; a key outside the tenant's folder, or with `..`,
  empty or odd segments, throws `TenantFileScopeError` whoever calls. Files are immutable: `put`
  refuses an existing key (`TenantFileExistsError`), so nothing is ever overwritten.
  `LocalDiskTenantFileStorage` (writes aside, then links into place) serves development
  (`FILE_STORAGE_DIR`) and the hub (`<HUB_DATA_DIR>/files`). An object-store adapter implements
  the same interface later.
- **`TenantFile`** rows (kind, storage key, verified type, size, SHA-256) go through the
  tenant-scoped client, and a database check keeps every storage key inside its tenant's folder.
- **Uploads** are the raw bytes with their `Content-Type` (`POST /tenants/:tid/files?kind=`,
  `settings.manage`, cloud only). Accepted: PNG, JPEG and WebP logos up to 512 KB; the same or ICO
  favicons up to 128 KB. The bytes' signature must match the declared type: an SVG, HTML or a
  renamed file is refused (`415 FILE_TYPE_NOT_ALLOWED`), whatever it claims to be. Oversized files
  answer `413 FILE_TOO_LARGE`.
- **Serving**: any member of the tenant reads a file (`GET …/files/:id/content`, cloud and hub)
  with its verified type, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. Only
  the files the tenant's branding shows are public: the website's
  (`/public/tenants/:slug/files/:id`) and the hub's sign-in screens'
  (`/hub/branding/files/:id`); every other upload stays private.
- Branding refers to files by id; the API refuses a file that is not the tenant's
  (`404 FILE_NOT_FOUND`) or not of the right kind.

### Where branding is read

- `GET /tenants/:tid/context?surface=` (cloud and hub, ADR 0018) now carries the branding
  resolved for the surface. Apps pass their surface; the admin has none and gets the tenant's
  defaults.
- `GET`/`PUT /tenants/:tid/branding` is the admin's Branding page (Settings → Branding, EN/AR,
  RTL): names, logo and favicon, colours with live contrast messages, light or dark, cards,
  corners, typeface, per-screen overrides and a preview in either theme. Each save is audited
  (`branding.updated`), as is each upload (`tenant_file.uploaded`).
- The customer website's `GET /public/tenants/:slug` carries the `website` branding.
- The hub's public `GET /hub/branding?surface=login` gives the POS and KDS sign-in screens their
  business's look before anyone signs in.

### Branding reaches the hubs

`tenant_branding` has a change-feed trigger (`record_config_change('self')`). The snapshot
(format **4**) carries `tenantFiles` (the files branding refers to) and `tenantBranding`, both
replaced wholesale on the hub, and a top-level `files` list with each file's bytes (base64). The
hub checks each copy against its row (SHA-256, size, image type) before storing it, and refuses
the whole snapshot otherwise. Files are not change-fed: they are immutable, and only reach a hub
once branding refers to them, which is a branding change.

## Consequences

- A tenant's look is data: a new colour or logo reaches open screens within a minute (the
  context refresh) and hubs through the change feed, without a deploy.
- Screens cannot hardcode a colour or the platform's name without failing lint or the brand test.
  Receipts stay black on white.
- A tenant cannot pick a brand colour that some screen would render unreadable, including a dark
  KDS and a light POS of the same tenant. The trade-off is that very light or very dark brand
  colours must be adjusted to a mid-tone.
- Snapshots grow by the size of the tenant's logos and favicon (at most a few hundred KB, base64),
  and only while branding refers to them. Unreferenced uploads stay in the cloud's storage: a
  clean-up of files no branding refers to is left for later, as is an object-store adapter.
- Uploading needs the cloud; reading, and the whole look, work offline on the hub.
- Device-level theme choice lives on the device. When staff devices get an identity (M6/M10), a
  device row can carry it in the server's DEVICE layer without changing the resolution.
