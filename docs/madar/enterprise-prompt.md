**MADAR Enterprise expansion: phases E0–E9**

You are continuing work on MADAR (repo root = this checkout). M1–M10 and product pictures (ADR 0027)
are merged on `main`. Read `docs/architecture.md` (especially §Known gaps), `docs/madar/migration-plan.md`,
`docs/domain-model.md`, `docs/api.md`, `docs/sync.md` and ADRs 0013, 0016–0027 before planning.

**Ground rules (apply to every phase)**

1. Development only, no live data: no backward-compat shims, migrate freely, re-seed demo data.
2. One phase = one ADR (next number after 0027) + one branch cut from the latest `main` + one PR.
   **Stop after each phase** and wait for my "go" before starting the next one.
3. Before any code in a phase: brainstorm, then write a plan and show it to me (superpowers:brainstorming → writing-plans).
   Use TDD for domain/server logic.
4. Keep tenant isolation: every new tenant-owned table gets `tenantId`, goes through `scopeToTenant`;
   `runUnscoped` only via the allowlist. Cloud-only tables stay out of the hub schema; run `npx prisma format`
   on the cloud schema before `pnpm --filter @pos/database hub:schema`. Bump the snapshot format if the hub snapshot changes.
5. Every new route has an access class in the route inventory (`public`, `guarded`, `permissions`, `device`,
   `host`, `platform`) and Zod validation of body/query/params. New permissions are seeded into roles.
6. Money stays integer minor units; strings go in EN and AR (`packages/i18n`), RTL checked; the brand name
   never appears as a word in code or translations (`tools/brand/brand.test.mjs`).
7. Each phase is done only when this gate is green, with output shown: `pnpm typecheck`, `pnpm lint`,
   `pnpm format:check`, `pnpm test`, `pnpm test:tools`, `pnpm version:check`, `pnpm e2e` (add new E2E
   scenarios after the last numbered one), plus a manual browser check (dark + light, EN + AR, phone width
   for customer-facing pages) on a freshly seeded check DB, with screenshots.
8. Update `docs/` (architecture, domain-model, api, configuration, events, testing), the §Known gaps list
   (remove what you closed, add what you defer), and `CHANGELOG.md`.

---

**E0: UI/UX audit and enterprise design system (no code changes)**
Use the **ui-ux-pro-max** skill to review the current UI of `customer-web`, `kiosk`, `pos`, `kds`, `admin`
and `platform-admin` (run them, screenshot the main screens). Produce `docs/madar/design-system.md` with:
problems found (per app, with severity and screenshot), and a proposed professional, enterprise-level design
system: tokens (primitive → semantic → component, mapped onto the existing M3 tenant branding/theme so
tenants still re-colour it), typography (Arabic + Latin pairing), spacing, radius, elevation, motion,
component specs (buttons with all sizes/states, inputs, cards, dialogs, tables, toasts, empty/loading/error
states), touch-target rules for kiosk/POS, accessibility (WCAG AA contrast, focus, reduced motion).
Include before/after mock-ups of the website home, menu, cart/checkout and the kiosk attract → menu → cart →
pay flow. **Stop for my approval of the design system.** Later phases implement it.

**E1: Enterprise organizations (one owner, many brands)**
Add an `Organization` above `Tenant` (each brand, e.g. KFC and Pizza Hut, stays a full tenant with its own
menu, branding, website and domains; each has its own locations). Owner/org-level users have one login and
can switch between the organization's tenants (tenant switcher in admin) without signing in again; access is
granted per organization, per tenant or per location. Add organization-wide reports (sales by brand, by
location, totals) and an organization dashboard in admin. Platform admin can create an organization, attach
new or existing tenants, and see it in the tenants list. Single-brand tenants keep working (an org of one).
Seed a demo organization with two brands and several locations each. Isolation tests: an org user never
sees another organization's tenants; a tenant-only user never sees sibling brands.

**E2: Account security and platform users**
a. Per-account lockout on top of the existing per-IP throttle: after N failed password sign-ins on one account
(any IPs) within a window, lock it for a growing period; same for platform users; configurable; audit-logged;
admin can unlock a user, platform admin can unlock a platform user. Same failure response for unknown and
locked accounts (no account enumeration). PIN sign-in keeps its per-employee throttle.
b. Platform admin **Users** screen: list, invite/create, edit role, deactivate, reset password, unlock,
with a platform permission check and `PlatformAuditLog` entries. The last active owner cannot be removed.

**E3: Online-ordering protection and customer cancellation**
a. Rate limit order creation on the website (and the public order endpoints) per client IP, plus per phone
number and per device/session, with configurable limits per tenant (sensible defaults); works behind
`TRUST_PROXY`. Over the limit → typed error and a friendly localized message. Add optional checks against
fake orders: max open unpaid orders per phone, and a tenant setting to require online payment above an amount.
b. Customers can cancel their own website order from the status page while it is still waiting for
acceptance (tenant-configurable: also allowed after acceptance until preparation starts, or never). Cancelling
voids/refunds any online payment through the existing provider path, updates the hub via sync, removes the
kitchen ticket, and notifies POS. Support staff in admin can also cancel with a reason.

**E4: Promo codes and tips for online ordering**
Promo codes managed in admin per tenant (and optionally per location): percent or fixed amount, minimum order,
validity dates, usage limits (total and per customer phone), pickup/delivery only, stacking rules. Applied in
cart/checkout with server-side validation and recorded on the order (reuse `Discount` / `OrderDiscount` where
it fits; explain the choice in the ADR). Tips at checkout: preset percentages + custom, tenant can enable/disable,
shown on receipts and in reports, kept separate from revenue and tax. The total, tax and rounding rules stay
correct in both tax-inclusive and tax-exclusive locations; add property/unit tests for the maths.

**E5: POS sound alerts and reprinting past bills**
a. POS plays a sound alert (and shows a visual banner/badge) when a new website order or kiosk order arrives,
and when a kitchen ticket is printed/created, repeating until acknowledged for orders needing acceptance;
per-terminal settings: on/off per event type, volume, sound choice; respect browser autoplay rules (unlock
on first interaction) and work in the Tauri app. Driven by the existing realtime events.
b. Order history in POS: search past orders by number, date, amount, customer phone, payment method (including
previous business days, fetched from the hub and, when needed, the cloud); reprint the customer receipt and
the kitchen ticket. Reprints are marked "COPY / REPRINT", permission-checked, and audit-logged.

**E6: Website and kiosk redesign, welcome media, QR**
Implement the approved E0 design system in `customer-web` and `kiosk` (shared components in `packages/ui` /
`app-kit`; then apply the new button and form components in POS/admin where it is cheap). Add:

- A QR code on the website (e.g. footer/"order on your phone" section and printable per-location/per-table
  QR from admin that opens the website for that location, and optionally that table).
- **Welcome media**: images or a short video uploaded in admin, set per tenant with an optional override per
  kiosk device; shown on the kiosk attract/idle screen (loop, playlist, tap to start) and as the website hero.
  Reuse `TenantFile` uploads and the product-picture pipeline (ADR 0027): type/size limits, image resizing,
  video size cap, cached on the hub for offline kiosks.
  Pass ui-ux-pro-max's pre-delivery checklist; Lighthouse accessibility ≥ 95 on the website.

**E7: Hub bundled in the POS for one-till shops, and hub packaging**

- Ship the hub (`apps/gateway`) as a Tauri sidecar in the POS app: one "MADAR POS" installer installs both;
  opening POS starts the hub if this device is configured as "all-in-one", and POS talks to it on localhost.
  First-run wizard chooses all-in-one vs connect-to-existing-hub. Clean shutdown and restart on crash.
- Stand-alone hub: installer and background service that starts on boot (Windows service, macOS launchd,
  Linux systemd), with logs and an update path compatible with M10 releases.
- Hub data on an encrypted disk/volume, or SQLite encryption at rest (choose and justify in the ADR;
  key stored in the OS keychain).
  Document install/uninstall/upgrade in `docs/release.md`; test what can be tested in CI, and list the manual
  per-OS checks.

**E8: Inbound Orders API (on demand, per tenant)**
For tenants that have their own website or app: a feature-flagged (M2 feature modules, off by default,
enabled per tenant by the platform or tenant admin) public **Integration API**:

- API keys per tenant (and optionally per location), created/revoked in admin, stored hashed, scoped
  (menu:read, orders:write, orders:read), with per-key rate limits and audit.
- `GET` menu feed: categories, products, variants, modifiers, prices, tax, availability per location, images,
  with ETag / `updatedSince`.
- `POST` order intake with an idempotency key, server-side re-pricing and validation, paid/unpaid status,
  then the same flow as website orders (hub, KDS, POS alert from E5). `GET` order status, and outgoing
  webhooks (signed with HMAC, with retries) for status changes.
- OpenAPI spec + docs page; a Postman collection is welcome.

**E9: Outbound connectors for kiosk-only clients**
For clients who use only our kiosk with another vendor's POS: a per-vendor **integration connector** framework
(cloud-side, like `PaymentProviderFactory`): per-tenant connector account with sealed credentials (reuse the
M8 `SecretBox`); scheduled menu pull (items, prices, availability) into MADAR with mapping and a "last sync"
status/errors screen in admin; push each kiosk order to the vendor through an outbox with retries; track the
vendor's order and payment status back onto the order. Ship it with a **mock vendor** adapter (and a mock
vendor server for E2E) only; real vendors are added later as adapters.

Start with **E0** only. Confirm you have read the docs listed above, then begin.
