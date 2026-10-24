# ADR 0023: The website's tenant is its verified host name, and its pages are configured sections

- Status: Accepted (2026-10-24)

## Context

Until M7 the customer website served one tenant per deployment: the browser named it
(`VITE_TENANT_SLUG`) and called `/public/tenants/:slug`. ADR 0017 resolved the slug, a location or
a tracked order to its tenant on each public route and promised that M7 would replace the slug
with the verified host name. A multi-tenant platform needs one website build serving every
tenant, each on MADAR's address for it and on the tenant's own domain, and each with its own
pages, not just its own colours (ADR 0019).

Three risks shaped the design:

- **Impersonation.** Whoever can make a host name resolve to a tenant can show that tenant's
  pages, take orders in its name, and read its tracked orders. A domain someone merely typed into
  a form must never do that, and a name claimed by one tenant must never reach another.
- **Trusting the browser.** Anything the browser sends (a tenant id, a slug, a header, a body
  field) is attacker-controlled. The host is the only input, and `X-Forwarded-Host` is just as
  forgeable unless a trusted proxy set it.
- **Certificates on demand.** Serving custom domains over HTTPS means issuing certificates for
  names the platform does not know in advance. An open issuer can be made to request certificates
  for any name pointed at it, which exhausts rate limits and serves unverified names.

## Decision

### Domains: only VERIFIED names resolve

`TenantDomain` (cloud only): id, tenant, normalized `domain`, `kind` (`SUBDOMAIN`, `CUSTOM`),
`isPrimary`, `status` (`PENDING`, `VERIFIED`, `FAILED`, `DISABLED`), a random 128-bit
`verificationToken`, `verifiedAt`, `lastCheckedAt`.

- **Normalized once, compared once.** `normalizeHostname` (`@pos/domain`): lower case, IDNA
  (punycode) through the WHATWG URL parser, no port, no trailing dot; a pasted URL loses its scheme
  and path. The request's host and every added domain go through it, and the database checks the
  stored form.
- **MADAR's address.** `provisionTenant` creates `<slug>.<PLATFORM_WEB_DOMAIN>` verified (and
  primary unless the tenant has one). `PLATFORM_WEB_DOMAIN` is `madar.app` in production
  (`localhost` is refused there) and `localhost` in development, where browsers resolve
  `*.localhost` to the machine. No tenant can add a name equal to or under the platform domain:
  those addresses belong to the tenants of those slugs.
- **Custom domains are proven by DNS.** The tenant adds a name (PENDING) and publishes the TXT
  record `_madar-verify.<domain>` = `madar-verify=<token>`. Verifying looks it up through a
  `DomainVerifier`: `DnsDomainVerifier` (system resolver, short timeout; record chunks joined,
  other records ignored) or the documented `MockDomainVerifier` (`DOMAIN_VERIFIER=mock`, refused
  in production), which finds every record unless a test refuses it. Found: VERIFIED; not found:
  FAILED and `422 DOMAIN_NOT_VERIFIED` with the record to publish. A disabled domain verified
  again serves again.
- **One owner per name.** A partial unique index allows a name to be VERIFIED for one tenant at
  most. Several tenants may hold PENDING claims on the same name: only the one whose token is in
  DNS can verify it, so a squatter's claim neither serves anything nor blocks the owner. Once a
  name is verified, other tenants can no longer add or verify it (`409 DOMAIN_TAKEN`).
- **Primary and disabled.** One primary per tenant (a partial unique index); only a verified
  domain can be primary. MADAR's address and the primary domain cannot be disabled
  (`409 DOMAIN_LOCKED` with the reason). Every change is audited (`domain.*`).

### Resolution: `HostTenantGuard` and the `host` route class

- `@HostRoute()` marks a website route and attaches `HostTenantGuard`. The route inventory lists
  such routes as a new class, **`host`**. `createServerApp` refuses to start with a host route that
  also requires staff permissions or devices, or that lacks the guard. The global guards let host
  routes through without a token; the feature guard hands their modules to the host guard.
- The guard reads Fastify's `request.host`: the `Host` header, or `X-Forwarded-Host` only when the
  request came through a trusted proxy (`TRUST_PROXY`, ADR 0016). It looks the name up among
  **VERIFIED** domains across tenants (`HostTenantResolver`, the one file allowed to do so on the
  `pos-local/no-unscoped-prisma` allowlist, replacing the storefront's slug resolver). No match:
  `404 SITE_NOT_FOUND`.
- The request is then scoped to that tenant like a staff request (`request.scope`, so the
  tenant-scoped client confines every query to it); a `:locationId` must be the tenant's
  (`404 LOCATION_NOT_FOUND`); the route's modules are checked for the tenant and location.
- **Nothing else names the tenant.** Tenant ids, slugs and headers sent by the browser play no
  part; `POST /orders` checks that the body's location is the host's tenant's, and tracking finds
  the order inside that tenant only, so another tenant's location, order or tracking token is not
  found.
- **Development fallback.** `DEV_DEFAULT_TENANT_SLUG` serves that tenant on bare
  `localhost`/`127.0.0.1` only, never on a name someone added, and is refused in production.

Routes: `GET /public/site` (the tenant, its active locations, branding, currency, languages and
website), `/public/site/files/:fileId`, `/public/site/locations/:id`,
`/public/site/locations/:id/menu`, `POST /orders`, `GET /orders/track`. The slug routes are gone.

### Hosting: same origin behind a reverse proxy

The website and its `/api` are served on the same origin by the reverse proxy, so no per-domain
CORS configuration exists (CORS stays an allowlist for the staff apps). The infrastructure example
(`infrastructure/caddy/Caddyfile`) uses Caddy's **on-demand TLS** with an `ask` endpoint,
`GET /internal/domains/check?domain=`, which answers `200` only for a VERIFIED domain, so
certificates are requested only for names a tenant has proven. The endpoint sits outside
`/api/v1` beside the health checks and the proxy does not expose `/internal` to the internet; it
only tells whether a name is served, which DNS shows anyway. The API runs with `TRUST_PROXY=1`
behind it.

### The website is configuration: sections validated by one schema

`WebsiteConfig` (cloud only, one row per tenant): `draft` and `published` JSON, `version`,
`publishedAt`. No row means MADAR's template for the business type, never published.

- `websiteConfigSchema` (`@pos/validation`) is a zod **discriminated union** of eleven section
  types: Hero, FeaturedProducts, Categories, About, Gallery, Testimonials, Locations, Contact,
  OpeningHours, PromoBanner and Footer, plus navigation, social links and SEO. Each section has an
  `id` (its anchor), `type`, `enabled`, `order`, `content` and `appearance` (background and
  alignment from design tokens). Unknown keys, types and languages are refused; text is localized
  per M4 locale with length limits; links are `#section`, `/page` or `https://` only, so no link
  can run script; one footer at most; unique ids.
- **Defaults from the business.** `defaultWebsiteConfig(businessType)` picks a template (food or
  shop wording) by lookup, never by comparison (ADR 0018). Colours, logo and names come from the
  tenant's branding at render time.
- **References are the tenant's.** Saving and publishing check that every picture is the tenant's
  `WEBSITE_IMAGE` file (M3 storage; a new file kind, PNG/JPEG/WebP up to 2 MB) and every product,
  category and location named is the tenant's. Pictures uploaded for the website are public on
  the tenant's site, like its branding files; other uploads stay private.
- **Draft, preview, publish.** The admin saves the draft (`PUT …/website/draft`), and publishing
  copies it to `published` as the next version. Visitors only ever see the published version. A
  preview link (`POST …/website/preview`) carries a 30-minute HMAC token naming the tenant; the
  site sends it (`x-website-preview`) and gets the draft, uncached, on that tenant's own host
  only. Saves and publications are audited (`website.*`).

### The customer website renders sections

- One build serves every tenant: the API client calls `/public/site` on its own origin;
  `VITE_TENANT_SLUG` is gone. Nothing of the site renders until it is known, so its branding
  (M3), currency display and languages (M4) apply before the first paint of its pages; an unknown
  host says the website was not found.
- `SECTION_RENDERERS` maps every section type to a component, typed as a complete map so a new
  type does not compile without a renderer. Text follows the visitor's language, else the store's
  default, else any language that has it. The existing ordering flow (menus, cart, checkout,
  tracking) is unchanged and reached from the Locations, FeaturedProducts and Categories sections.
- The admin's `?preview=` token is kept for the tab only and taken out of the address bar, and a
  banner marks the page as a preview.

### The admin

Website → **Website editor** (switch sections on and off, reorder, add, remove, edit each type in
every supported language with its own text direction, upload pictures, navigation, social links,
SEO; save, preview, publish) and **Domains** (MADAR's address and custom domains, the TXT record,
verify, make primary, disable). Both need `ONLINE_ORDERING` and the new tenant-wide
`website.manage` permission; EN/AR with RTL.

## Consequences

- One deployment serves every tenant's website; a tenant changes its pages and domains without a
  deploy, and nothing reaches visitors before it is published.
- A host name is the website's whole identity. Pointing an unverified name at MADAR shows nothing
  and gets no certificate; a verified name serves its tenant only, and nothing the browser sends
  can change that. The security tests walk every host route with unknown, pending, failed and
  disabled hosts and with another tenant's locations.
- Behind a proxy, `TRUST_PROXY` must count it, or `X-Forwarded-Host` is ignored and the site is
  resolved from the proxy's own `Host` (which Caddy forwards unchanged anyway).
- The website, domains and website pictures are cloud-only: hubs never see them (their tables
  stay out of the hub schema, whose generator now also drops relation fields to cloud-only
  models).
- Left for later: periodic re-verification of custom domains (a lapsed TXT record keeps the
  domain verified until disabled), a redirect from secondary domains to the primary one, product
  pictures on the website, server-side rendering for search engines (the SEO title and description
  are set in the page), and domain management by the platform operator (M9).
