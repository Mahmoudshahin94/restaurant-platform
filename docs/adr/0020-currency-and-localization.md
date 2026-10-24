# ADR 0020: A tenant's currency display and languages are configuration; its currency is not

- Status: Accepted (2026-10-24)

## Context

After M1–M3 ([ADR 0017](0017-tenant-root-and-isolation.md),
[ADR 0018](0018-feature-modules.md), [ADR 0019](0019-branding-and-theme.md)) every tenant has
its own currency code and its own list of languages, but neither reached the screens properly:

- Amounts were formatted with `Intl`'s defaults for the currency code and the screen's language.
  A shekel tenant could not choose how ₪ is written; a currency whose `Intl` decimals differ from
  ISO 4217 (IQD: `Intl` shows none, the platform stores three) was rounded on screen.
- Hardcoded fallbacks assumed the first market: forms in the admin parsed money as `'SAR'` before
  the tenant had loaded and proposed `Asia/Riyadh` for new locations, and the demo tenant was in
  riyals. MADAR's first market is Palestine: shekels, `Asia/Hebron`.
- Every screen offered both languages, whatever the tenant offered, and started in the browser's
  language. The tenant's default and the user's `preferredLocale` were stored and never used.
- Digits were always Latin, although the formatters already took a numbering system.

ADR 0002 stands: amounts are integers in the currency's minor units, and the currency is fixed
when the tenant is provisioned, because changing it would rescale every stored amount.

## Decision

### The currency stays fixed; how it is shown is configuration

`CurrencyConfiguration` (`@pos/shared-types`) is everything a screen needs to show an amount:

| Setting         | Values                                     | MADAR default                       | Who sets it                   |
| --------------- | ------------------------------------------ | ----------------------------------- | ----------------------------- |
| `code`          | ISO 4217, one of `SUPPORTED_CURRENCIES`    | `ILS` for new tenants               | the platform, at provisioning |
| `decimalPlaces` | from ISO 4217 (`currencyExponent`)         | 2 for ILS, USD, EUR, GBP; 3 for JOD | nobody: derived, read-only    |
| `symbol`        | 1–8 characters, no digits or control marks | `₪` for ILS; else `Intl`'s symbol   | the tenant                    |
| `display`       | `narrowSymbol`, `symbol`, `code`           | `narrowSymbol`                      | the tenant                    |
| `formatLocale`  | one of `FORMAT_LOCALES`, or none           | none: the screen's language         | the tenant                    |

- **Resolution** is `resolveCurrency(code, tenantLayer)` in `@pos/domain`, built on
  `resolveLayered`: platform → tenant. Each display setting names its layer, as modules and
  branding do. The platform layer's symbol depends on the currency (`PLATFORM_CURRENCY_SYMBOLS`):
  ₪ for the shekel, so a tenant that chooses the `symbol` display, or an English format locale,
  still sees ₪.
- **Storage:** nullable tenant columns `currency_symbol`, `currency_display`,
  `currency_format_locale` (null inherits), with database checks on the display and the
  symbol's length. They ride the tenant row, so the change feed and the snapshot carry them to
  every hub without a new table.
- **The format locale** is a closed list (`en-US`, `en-GB`, `ar-PS`, `ar-JO`, `ar-SA`, `ar-AE`,
  `fr-FR`, `de-DE`), like the typefaces of ADR 0019: the admin can offer it and nothing a tenant
  types reaches `Intl` unchecked. When set, amounts use it on every screen (a euro store can show
  `1.234,56 €` in its English UI); when not, they follow the screen's language.
- **New tenants default to ILS:** `DEFAULT_TENANT_CURRENCY` is the column default, the default of
  `createTenantSchema` and of `provisionTenant`. The seed's demo restaurant is now in shekels in
  `Asia/Hebron`.

### Formatting takes the configuration, and never a float

`formatMoney(minor, currency, locale, { digits, sign })` (`@pos/i18n`) takes a
`CurrencyConfiguration`, or a bare code for MADAR's display of that currency:

- The amount is still the exact decimal string of the minor units, passed to
  `Intl.NumberFormat` (ADR 0002).
- `minimumFractionDigits` and `maximumFractionDigits` are the ISO decimal places, so `Intl`'s own
  idea of a currency's decimals never rounds an amount (IQD, LBP).
- A symbol override replaces the currency part of `formatToParts`, with a no-break space where a
  letter would touch the digits (`JD 5.000`). The `code` display always shows the code.
- `parseFloat` and `Number.parseFloat` are refused by lint across the codebase: amounts are parsed
  with `parseDecimalToMinor`, which rejects extra decimals instead of rounding.

`useMoneyFormat(currency?)` (`@pos/app-kit`) reads the configuration from a
`LocalizationProvider`: `TenantProvider` provides the tenant context's, the website provides its
public tenant's. Given an amount's own currency code (an order's, a menu's), it uses the tenant's
configuration when the codes match and MADAR's display otherwise; given none, the tenant's. The
admin's money forms now take the currency from the tenant context, which loads before any page,
so no form needs a fallback currency or time zone.

### Languages drive every app

| Setting            | Values                       | MADAR default | Who sets it |
| ------------------ | ---------------------------- | ------------- | ----------- |
| `supportedLocales` | a non-empty subset of en, ar | both          | the tenant  |
| `defaultLocale`    | one of the supported         | `en`          | the tenant  |
| `digits`           | `latn`, `arab`               | `latn` (0–9)  | the tenant  |

- **The rule** (`selectLocale`, `@pos/domain`): the device's stored choice if the tenant offers
  it, else the signed-in user's `preferredLocale` if offered, else the tenant's default. The
  customer website has no user: the visitor's choice, else the store's default. Apps start in the
  stored choice or the browser language until the tenant is known (`initialLocale`); then
  `useLocaleSelection` (called by `TenantProvider`, the website's shell and the hub's sign-in
  screens) applies the rule before paint. Only the language switcher stores a choice.
- **The switcher** offers only the supported locales and is not rendered for a single-locale
  tenant (`showsLanguageSwitcher`). The admin's sign-in screen has no tenant yet and offers every
  platform locale; the POS and KDS sign-in screens read their hub's public `GET /hub/locales`.
- **Direction** follows the locale, as before (`applyDocumentLocale`): an Arabic-only tenant is
  right-to-left everywhere, an English-only one left-to-right.
- **Digits:** `arab` writes Arabic in Arabic-Indic digits (٠–٩) in money, numbers, dates and
  times, on screens and on receipts (`useFormatOptions`). English is always written in Latin
  digits, whatever the setting, so a tenant cannot make its English screens unreadable.
- `resolveLocales` keeps the platform's order of locales and always includes the default.

### Where it is read and written

- `GET /tenants/:tid/context` (cloud and hub) carries `currency: ResolvedCurrency` (code,
  decimal places, symbol, display, format locale, sources) and
  `locales: ResolvedLocales` (default, supported, digits, sources). The context's former
  `currency.exponent` is now `decimalPlaces`.
- `GET /public/tenants/:slug` carries the same `currency` and `locales` instead of
  `currencyCode` and `defaultLocale`.
- `GET`/`PUT /tenants/:tid/localization` (`settings.manage`, cloud only) is the admin's
  **Language and currency** page (Settings, EN/AR, RTL): the languages offered, the default,
  the digits, and the currency's symbol, display and format locale, with the code and decimal
  places shown read-only and a live preview in each language. `PUT` replaces all six settings;
  the body is strict, so a `currencyCode` or `decimalPlaces` is refused (`400`), as is a default
  locale outside the supported ones. Each save is audited (`localization.updated`, with the
  values before).
- `PATCH /tenants/:tid` keeps the names, legal name and time zone only, and is strict too: the
  business type, the languages and the currency are refused there instead of being dropped.
- The hub serves the context and `GET /hub/locales` (public, like `GET /hub/branding`) from the
  tenant row of its snapshot, offline.

## Consequences

- A shekel tenant sees ₪ in the admin, the POS, the KDS, receipts and its website by default,
  and can write it otherwise without a deploy. Open screens pick up a change within a minute, hubs
  through the change feed.
- No app hardcodes a currency, a time zone or a language list; the riyal and `Asia/Riyadh` remain
  only in tests that exercise other markets.
- A single-language tenant never shows a language switcher, including on its hub's sign-in
  screens and its website.
- Changing a tenant's currency is still impossible through any API. Development databases seeded
  before this phase keep the demo restaurant in riyals until they are reset; the E2E databases
  realign their demo tenants on every run (`SEED_ALIGN_TENANTS=1`, only while a tenant has no
  orders).
- A per-location or per-device currency display (a branch abroad) is not needed yet; the
  resolution has the layers for it.
