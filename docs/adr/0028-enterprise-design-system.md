# ADR 0028: Enterprise design system

- Status: Accepted (2026-10-31)

## Context

Enterprise phase E0 reviewed every app's UI before the enterprise work (E1–E9) changes any screen. The review
used the UI/UX Pro Max rule set, a code audit and screenshots of each app on a seeded check database.

- **What works:** the token foundation from M3 ([ADR 0019](0019-branding-and-theme.md)), the contrast checks on
  tenant colours, RTL through logical properties, one icon set, and labelled fields and images.
- **What doesn't:** the layer above the tokens. The storefront apps look like admin screens, and the kiosk is
  laid out for landscape. Elevation, motion, z-index, type-scale and density tokens are missing. About fifteen
  shared components are missing, so the same control is rebuilt per app. The Button has no loading state, and
  POS uses 32 px buttons on a touch screen.

The full findings, with severity and screenshots, are in
[docs/madar/design-system.md](../madar/design-system.md) §2.

## Decision

[docs/madar/design-system.md](../madar/design-system.md) is the design system. In short:

- **Three surface profiles on one set of tokens:**
  - **Storefront** (website, kiosk): light by default, picture-led, 44 px targets on the web and 64 px on the
    kiosk.
  - **Counter** (POS, KDS): dark, touch density, a "distance" type scale on the KDS.
  - **Console** (admin, platform admin): light, compact.

  The profile is set by `data-profile` on `<html>`, beside the existing `data-theme`.

- **Tokens stay in `packages/ui/src/styles/theme.css`, in three layers:**
  - primitive: neutral and brand scales, with the brand scale derived from the tenant's primary colour;
  - semantic: the existing names, plus surfaces, `border-strong`, `primary-subtle`/`-hover`, `info` and
    `-subtle` status colours;
  - component: control heights, card padding, icon size and table row height per profile.

  They add elevation, z-index, motion (gated by `prefers-reduced-motion`), a type scale and spacing. Every radius
  derives from the tenant radius. `destructive` is never tenant-controlled.

- **Button:**
  - variants `primary`, `secondary`, `outline`, `ghost`, `destructive`, `link`;
  - sizes `sm` 32 (console only), `md` 40, `lg` 48, `xl` 56, `2xl` 72;
  - a `loading` prop (`aria-busy`, spinner, width kept);
  - disabled on a neutral surface instead of faded brand colour.
- **New shared components in `packages/ui`:** Select, DropdownMenu, SegmentedControl/Tabs, Toast, AlertDialog,
  Skeleton, Sheet, Tooltip, QuantityStepper, OptionTile, ProductCard (with a no-picture fallback tile),
  StatCard, DataTable, Chart (Recharts, admin only), StatusBadge and PageShell.
- **Accessibility bar for every later phase:**
  - WCAG 2.2 AA;
  - text never below 12 px, and errors, prices and status never below 14 px;
  - a skip link in the website and the console apps;
  - status never shown by colour alone.

Approved answers to the open questions:

1. The storefront defaults to light.
2. Every app uses the shared no-picture fallback tile.
3. Charts use Recharts in the admin.

## Consequences

- E0 changes no product code. Each later phase implements the parts it needs:
  - E1: tokens, PageShell, StatCard, DataTable, Chart.
  - E2: the platform logo fix, plus Toast and AlertDialog.
  - E5: the POS fixes.
  - E6: the full storefront redesign.

  Design debt a phase leaves goes into §2 of the design system document.

- The Button renames (`default` → `primary`, `touch` → `xl`) happen in one change across all apps, with no
  aliases kept (development only).
- The demo seed gains sample product pictures, so demos, screenshots and E2E show the picture layouts.
- Mock-ups (`docs/madar/design-mockups/`) are a guide, not a pixel contract; the tokens and component specs are
  the contract.
