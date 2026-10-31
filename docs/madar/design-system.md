# MADAR design system: E0 audit and proposal

Status: **approved 2026-10-31** (ADR 0028), with the recommended answers in §9. Nothing in the product code changes in E0. Phase E6 (website and kiosk)
implements it first, and later phases use it as they touch each app.

- **Screenshots of today's apps** are in [design-audit/](design-audit/). They were taken on 2026-10-31 from `main`
  at 8e74576, on a freshly seeded check database (`pos_kds_e0_check`) with a paired hub.
- **Mock-ups of the proposal** are in [design-mockups/](design-mockups/): the `after-*.jpg` images and the HTML they
  were taken from ([mockups.html](design-mockups/mockups.html)).
- **Method:** the UI/UX Pro Max rule set (accessibility, touch, performance, style, layout, typography, motion,
  forms, navigation, charts), a code audit of every app, and a walk-through of each app in the browser.

## 1. Summary

The foundation is better than most products at this stage, and the proposal keeps it:

- one token file (`packages/ui/src/styles/theme.css`, Tailwind v4 `@theme`, oklch);
- tenant branding is applied as CSS variables, with an automatic readable foreground and contrast checks
  (`packages/domain/src/branding/contrast.ts`);
- a lint rule bans raw colours (`pos-local/no-raw-colors`);
- the apps use logical properties everywhere (RTL works), lucide icons only (no emoji), alt text on every image,
  labelled fields, and self-hosted Inter + Noto Sans Arabic.

What keeps it from looking and feeling **enterprise-grade** is mostly the layer above the tokens:

1. **The storefront surfaces (website, kiosk) look like admin screens.**
   - Every app shows a product picture when one is uploaded (ADR 0027), but a product without one collapses
     to a text-only card with no fallback tile, and the demo data has no pictures, so every seeded screen looks
     like a price list.
   - The website defaults to the dark theme, and its hero is a flat block of colour.
   - The kiosk is laid out for landscape and wastes a portrait kiosk; its welcome screen is a name and a button.
2. **The token set is incomplete.**
   - There are no elevation, z-index, motion, type-scale, density or component-size tokens, so every app picks
     its own `shadow-lg`, `rounded-2xl` or `h-14`.
   - The xl/2xl/3xl radii ignore the tenant's radius.
3. **Shared components are missing.**
   - There is no Select, Menu, Tabs/Segmented control, Toast, Confirm dialog, Skeleton, Sheet, Tooltip,
     QuantityStepper, OptionTile or ProductCard.
   - So the same control is rebuilt per app: the option tile exists three times with three sizes, and the
     category pill and tender buttons are hand-rolled.
4. **The Button has no loading state.**
   - Disabled is a faded brand colour (low contrast in dark mode).
   - The `sm` size (32 px) is used on touch screens for "Take payment", "Refund" and "Clear".
5. **Header controls are native `<select>`s.**
   - Language and theme are two wide native selects in every header and sign-in screen.
   - Together they are the most prominent control on most screens.

## 2. Problems found, per app

Severity: **Critical** (blocks a task or fails WCAG A/AA), **High** (hurts a primary flow or the brand
impression), **Medium** (inconsistency or polish), **Low** (nice to have).

### Website (`apps/customer-web`)

Screenshots: `design-audit/web-*` (desktop and phone, dark and light, plus Arabic).

| #   | Severity | Problem                                                                                                                                                                                                               | Evidence                                                       |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| W1  | High     | A product without a picture renders as text plus a "+" button: `ProductPicture` returns nothing, so cards have no fallback tile and mixed menus look uneven. The demo seed has no pictures, so every demo shows this. | `web-desktop-light-02-menu.jpg`, `web-phone-light-02-menu.jpg` |
| W2  | High     | Dark is the default for a consumer storefront. Light reads better for food and for checkout forms. Today the platform default (dark) wins unless the tenant picks a mode.                                             | `web-desktop-dark-01-home.jpg`                                 |
| W3  | High     | The hero is a flat primary-colour panel with centred text and one dark button, which contrasts weakly with the panel. There is no image or media, no open/closed status and no secondary action.                      | `web-desktop-dark-01-home.jpg`                                 |
| W4  | High     | On a phone there is no sticky "View cart · total" bar. The cart is a small icon in the header, and the total is visible only on the cart page.                                                                        | `web-phone-light-02-menu.jpg`                                  |
| W5  | Medium   | The header gives two native `<select>`s (language, theme) more weight than the cart. The theme select reads "Business default", which customers don't understand.                                                     | every `web-*-01-home.jpg`                                      |
| W6  | Medium   | Category chips on the menu are about 30 px tall (under 44 px) and do not show the active category while scrolling.                                                                                                    | `web-phone-light-02-menu.jpg`                                  |
| W7  | Medium   | The menu grid mixes a two-column row with lone half-width cards (Sides, Drinks, Desserts), leaving ragged empty space on desktop.                                                                                     | `web-desktop-light-02-menu.jpg`                                |
| W8  | Medium   | Checkout is one long column on desktop. The summary sits at the bottom instead of a sticky side panel, and there is no step indicator.                                                                                | `web-desktop-light-05-checkout.jpg`                            |
| W9  | Medium   | The empty "Contact us" section renders as a large blank card (the section has no data).                                                                                                                               | `web-desktop-dark-01-home.jpg`                                 |
| W10 | Low      | There is no QR code to move from the desktop site to a phone, and no printable table/branch QR (planned in E6).                                                                                                       | n/a                                                            |
| W11 | Low      | The quantity stepper on the product dialog uses 40 px icon buttons.                                                                                                                                                   | `web-desktop-light-03-product.jpg`                             |

### Kiosk (`apps/kiosk`)

Screenshots: `design-audit/kiosk-*` (1080×1920 portrait, plus one landscape).

| #   | Severity | Problem                                                                                                                                                                                                    | Evidence                                 |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| K1  | Critical | The layout is landscape-first: a fixed 224 px category sidebar plus a side cart. On a portrait kiosk the product grid gets one narrow column, cards are small and the text is about 14 px at arm's length. | `kiosk-02-menu.jpg`, `kiosk-04-cart.jpg` |
| K2  | High     | The welcome (attract) screen has no media, no logo (when none is uploaded) and no motion: a name and a button in a dark void. This is the screen customers see most. (E6 adds welcome media.)              | `kiosk-01-welcome.jpg`                   |
| K3  | High     | Products without a picture get no fallback tile (same as W1), so the seeded kiosk is all text.                                                                                                             | `kiosk-02-menu.jpg`                      |
| K4  | High     | The options dialog is a small centred desktop dialog on a 1080 px-wide screen. Option tiles are about 30 px tall at the rendered scale, and choices are hard to scan.                                      | `kiosk-03-options.jpg`                   |
| K5  | Medium   | The header crams language, "Larger text", "Start over" and the staff entry into one row, all with the same weight.                                                                                         | `kiosk-04-cart.jpg`                      |
| K6  | Medium   | The cart's "Review and pay" is at the bottom of a side column, far from the products that were just tapped.                                                                                                | `kiosk-04-cart.jpg`                      |
| K7  | Low      | The staff entry is a near-invisible "Staff" label in a corner. Discreet is right, but it needs a 44 px target.                                                                                             | `kiosk-01-welcome.jpg`                   |

### POS (`apps/pos`)

Screenshots: `design-audit/pos-*` (1366×768, a common till resolution).

| #   | Severity | Problem                                                                                                                                                           | Evidence                                                                                    |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P1  | High     | The sign-in card is taller than a 768 px screen, so its top (the business name) is cut off with no scroll affordance.                                             | `pos-01-login.jpg`                                                                          |
| P2  | High     | Touch targets under 44 px on a touch till: `size="sm"` (32 px) on "Clear", "Take payment" and "Refund"; 40 px discount chips; and 36 px language/theme switchers. | `apps/pos/src/components/cart-panel.tsx:139,375`, `apps/pos/src/routes/orders-page.tsx:162` |
| P3  | Medium   | The disabled "Place order" is the brand colour at 50% opacity, which looks like a broken primary button in dark mode.                                             | `pos-02-register.jpg`                                                                       |
| P4  | Medium   | Tiles show a picture only when one exists; without one there is no colour or icon cue, so a mixed grid is uneven.                                                 | `pos-02-register.jpg`                                                                       |
| P5  | Medium   | The hand-rolled controls (category pills, tender buttons, PIN keypad, discount chips) have no `focus-visible` style, so they fall back to the browser outline.    | code audit                                                                                  |
| P6  | Low      | The status footer ("Live · Connected · 5 changes synced") is small and easy to miss. Sync problems should escalate to a banner.                                   | `pos-02-register.jpg`                                                                       |

### Kitchen display (`apps/kds`)

Screenshot: `design-audit/kds-01-board.jpg` (1920×1080 TV).

| #   | Severity | Problem                                                                                                                                                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Medium   | The top bar uses about 14 px text on a TV read from 2–3 m. It needs a "distance" type scale, and the counters (New / Preparing / Ready) should be larger and colour-plus-icon coded. |
| D2  | Medium   | The empty state is a thin full-width strip at the top of a black screen. It should be centred and larger, with the station name.                                                     |
| D3  | Low      | The station filter pills and Active/Bumped tabs are two different-looking segmented controls next to each other.                                                                     |

### Admin (`apps/admin`)

Screenshots: `design-audit/admin-*` (1440×900, light).

| #   | Severity | Problem                                                                                                                                                                                                                         | Evidence                                                                     |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A1  | High     | The dashboard is one card on an empty page with the stale copy "Full reports come later" (Reports exists). There are no KPIs over time, no trend and no cross-location view. This matters for E1, where owners run 20 branches. | `admin-01-home.jpg`                                                          |
| A2  | Medium   | The header holds three native selects (location, language, theme) plus the user and sign-out. The location switcher, the most important one, looks like the others.                                                             | every `admin-*`                                                              |
| A3  | Medium   | 30+ sidebar items in one long list with no collapse or search. With enterprise modules (organizations, integrations, promo codes) this will overflow.                                                                           | `admin-01-home.jpg`                                                          |
| A4  | Medium   | Report tabs are nine pill buttons that wrap to two lines. The only chart is a hand-built CSS bar chart.                                                                                                                         | `admin-03-reports.jpg`, `apps/admin/src/routes/reports/report-views.tsx:156` |
| A5  | Medium   | Tables have no sorting, sticky header, row density option, column alignment rules for numbers, or bulk actions.                                                                                                                 | `admin-09-menu-products.jpg`                                                 |
| A6  | Medium   | `text-xs` (12 px) is used 89 times, including field hints and errors. Audit IDs use `text-[10px]`.                                                                                                                              | `apps/admin/src/routes/system/audit-log-page.tsx:54`                         |
| A7  | Low      | Saving shows "Saving…" text on a disabled button. There is no success toast, so a save is confirmed only by the form resetting.                                                                                                 | code audit                                                                   |

### Platform admin (`apps/platform-admin`)

Screenshots: `design-audit/platform-*` (1440×900, dark).

| #   | Severity | Problem                                                                                                                                                                                    | Evidence                                                                       |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| L1  | High     | The MADAR mark is broken. The 132×32 wordmark SVG is squeezed into a 28×28 box (`size-7`), and its `currentColor` parts render black inside `<img>`, so the dark theme shows only a speck. | `apps/platform-admin/src/components/app-shell.tsx:52`, `platform-00-login.jpg` |
| L2  | Medium   | Same native-select header pattern as admin. There is no users screen yet (E2).                                                                                                             | `platform-02-tenants.jpg`                                                      |
| L3  | Medium   | `text-[10px]` IDs, one of them a link (`apps/platform-admin/src/routes/audit-page.tsx:53`).                                                                                                | code audit                                                                     |

### Across all apps

| #   | Severity | Problem                                                                                                                                                                 |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | High     | No shared Select, DropdownMenu, Tabs/Segmented control, Toast, AlertDialog (confirm), Skeleton, Sheet, Tooltip, QuantityStepper, OptionTile or ProductCard.             |
| X2  | High     | Button: no `loading` prop (`aria-busy`, spinner, width kept); disabled is `opacity-50` on the brand colour.                                                             |
| X3  | Medium   | No elevation, z-index, motion, type-scale or density tokens. Radii above `lg` aren't tenant-driven.                                                                     |
| X4  | Medium   | The shared `Spinner` animates regardless of `prefers-reduced-motion` (`packages/ui/src/components/spinner.tsx:10`).                                                     |
| X5  | Medium   | Destructive and primary can be the same red when a tenant picks red (as the mock-up shows). Destructive actions need an icon plus a confirm dialog, never colour alone. |
| X6  | Low      | Only customer-web has a skip link. Admin and platform admin need one too (long sidebars).                                                                               |

Side observation, outside design scope: while capturing, a full page load of an admin URL (not a client-side
navigation) landed on the sign-in screen. Check this against the cookie refresh in E2 (account security). It may
be specific to the dev proxy.

## 3. Direction

One system, three **surface profiles**. Every profile uses the same tokens and components and differs only in
default theme, density and type scale:

| Profile        | Apps                  | Default theme                  | Density  | Base text                               | Min target             | Character                                                  |
| -------------- | --------------------- | ------------------------------ | -------- | --------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| **Storefront** | website, kiosk        | Light (tenant may choose dark) | spacious | 16 px web, 20 px kiosk                  | 44 px web, 64 px kiosk | Brand- and picture-led; one bold primary action per screen |
| **Counter**    | POS, KDS              | Dark                           | touch    | 16 px POS, 18 px KDS ("distance" scale) | 48 px                  | Fast, high-contrast, status always visible                 |
| **Console**    | admin, platform admin | Light                          | compact  | 14 px                                   | 32 px (pointer)        | Swiss/minimal, data-dense, quiet chrome                    |

Style: **Minimalism / Swiss** for the console and counter (flat, sharp hierarchy, little decoration), and
**content-first commerce** for the storefront (large pictures, bold price, soft elevation). This replaces the
optional `glass` surface: blur stays only for scrims behind dialogs and sheets.

## 4. Tokens (primitive → semantic → component)

They stay in `packages/ui/src/styles/theme.css` (Tailwind v4 `@theme`, oklch). The profile is set with
`data-profile="storefront|counter|console"` on `<html>`, beside the existing `data-theme`.

### 4.1 Primitive

- `--neutral-0 … --neutral-950`: 12 steps, cool grey, hue 260.
- `--brand-50 … --brand-900`: generated from the tenant's primary colour at runtime (same hue, fixed lightness
  steps, chroma clamped). `brandingVariables()` already writes the primary, and it now writes the scale too.
- Status hues: `--green-*`, `--amber-*`, `--red-*`, `--blue-*` (500/600 and a subtle 50/950 pair each).

### 4.2 Semantic

Existing names are kept, so current classes keep working. New ones are marked **new**.

| Token                                                                                                               | Use                                                           |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `background`, `foreground`                                                                                          | page                                                          |
| `surface` **new** (alias of `card`), `surface-raised` **new**, `surface-sunken` **new**                             | cards; popovers/sheets; wells, inputs on cards, disabled fill |
| `muted`, `muted-foreground`                                                                                         | secondary text (≥4.5:1 on both surfaces)                      |
| `border`, `border-strong` **new**, `input`, `ring`                                                                  | dividers; control outlines (≥3:1); focus                      |
| `primary`, `primary-hover` **new**, `primary-subtle` **new**, `primary-subtle-border` **new**, `primary-foreground` | the brand action; its hover; selected backgrounds             |
| `secondary`, `accent`                                                                                               | tenant-controlled, as today                                   |
| `success`, `warning`, `destructive`, `info` **new**, each with `-foreground` and `-subtle` **new**                  | status, always paired with an icon or text                    |
| `overlay`                                                                                                           | scrims                                                        |

Rules:

- Any foreground/background pair must reach 4.5:1 for text and 3:1 for control outlines and focus rings. The
  existing `colourContrastIssues()` check is extended to `primary-subtle` and `border-strong`.
- `destructive` is **not** tenant-controlled. When the tenant primary is within ΔE 15 of it, destructive buttons
  switch to the outline style with an icon (rule X5).

### 4.3 Scales

| Scale       | Tokens                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spacing     | 4-pt base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Density sets the control padding, not the scale.                                                                                                                                                                                                |
| Radius      | `sm` 5 · `md` 8 · `lg` 11 · `xl` 16 · `full`. All derived from the tenant radius r (sm .6r, md r, lg 1.4r, xl 2r), so tenants control every corner.                                                                                                                                              |
| Elevation   | `shadow-1` (cards), `shadow-2` (sticky bars, popovers), `shadow-3` (dialogs, sheets), `shadow-4` (toasts). In dark mode: a border plus a lighter surface instead of darker shadow.                                                                                                               |
| Z-index     | `base 0`, `sticky 10`, `header 20`, `dropdown 30`, `sheet 40`, `dialog 50`, `toast 60`, `kiosk-idle 70`                                                                                                                                                                                          |
| Motion      | `fast 120ms` (press, hover), `base 200ms` (menus, tabs), `slow 320ms` (sheets, dialogs). Easing: `standard cubic-bezier(.2,0,0,1)`, `decelerate (0,0,0,1)` in, `accelerate (.3,0,1,1)` out. Exits at about 70% of enter. Everything is gated by `prefers-reduced-motion`, including the Spinner. |
| Breakpoints | 375 / 768 / 1024 / 1280 / 1536, plus `portrait`/`landscape` variants for the kiosk                                                                                                                                                                                                               |

### 4.4 Typography

- **Typefaces (kept):** Inter Variable (Latin) and Noto Sans Arabic Variable, self-hosted via `@fontsource-variable`.
  The search suggested Noto Naskh for Arabic headings, but it doesn't fit a commerce UI, so Noto Sans stays for
  both. The tenant typeface choices (INTER / SYSTEM / SERIF) stay.
- **Type scale:** display 48/56 · h1 32/40 · h2 24/32 · h3 20/28 · title 18/26 · body 16/24 · body-sm 14/20 ·
  caption 12/16 (the minimum, used only for metadata, never for errors or prices).
  - Kiosk multiplies by 1.25.
  - KDS uses a "distance" scale: body 20, ticket item 24, counters 32.
  - "Larger text" on the kiosk multiplies by a further 1.25 (exists today).
- **Weights:** 400 body, 500 labels, 600 buttons and table headers, 700 headings, 800 display and kiosk prices.
- **Numbers:** prices, totals, timers and table numbers use `tabular-nums`. The existing `.ltr-nums` isolation
  stays for Arabic.
- **Arabic:** line-height 1.7 is kept. Headings get no negative letter-spacing under `:lang(ar)`.

### 4.5 Component tokens

| Token                                         | Console         | Counter | Storefront web | Kiosk |
| --------------------------------------------- | --------------- | ------- | -------------- | ----- |
| `--control-h` (input, select, default button) | 36              | 48      | 44             | 64    |
| `--control-h-lg` (primary action)             | 40              | 56      | 52             | 72    |
| `--card-pad`                                  | 16              | 16      | 16–24          | 20    |
| `--icon-size`                                 | 16              | 20      | 20             | 28    |
| `--table-row-h`                               | 40 (compact 32) | —       | —              | —     |

## 5. Components

### 5.1 Button (`packages/ui/src/components/button.tsx`)

See `design-mockups/after-spec-light.jpg` and `after-spec-dark.jpg`.

- **Variants:** `primary` (renames `default`), `secondary`, `outline`, `ghost`, `destructive`, `link`.
- **Sizes:**

  | Size     | Height | Where                                              |
  | -------- | ------ | -------------------------------------------------- |
  | `sm`     | 32     | console only; lint forbids it in pos/kds/kiosk     |
  | `md`     | 40     | console default                                    |
  | `lg`     | 48     | counter default, storefront primary                |
  | `xl`     | 56     | renames `touch`; POS actions                       |
  | `2xl`    | 72     | kiosk start, pay and place order                   |
  | `icon-*` | —      | one per size, always square, `aria-label` required |

- **States:**
  - hover: `primary-hover`.
  - focus-visible: 2 px `ring`, offset 2, ≥3:1 against the surface.
  - pressed: `scale(.98)`, `fast`.
  - **loading:** a new `loading` prop sets `aria-busy`, disables the button, shows a leading spinner and keeps the
    width; the label can change to "Saving…".
  - **disabled:** `surface-sunken` fill, `muted-foreground` text and `cursor-not-allowed`, instead of opacity on
    the brand colour.
- **Content:** a verb first ("Place order · ₪37.00"). Icons are leading, `aria-hidden` when text is present.
  Each screen has one primary action.

### 5.2 New shared components

In `packages/ui` (Radix-based where an accessible primitive exists):

| Component                                                                                                                 | Replaces / used by                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Select` (Radix)                                                                                                          | most native `<select>`s in forms; native stays on phones where it helps                                                                                                                                                                                            |
| `DropdownMenu`                                                                                                            | user menu; language and theme menus in every header (rule W5/A2): one icon button each, e.g. globe and sun/moon                                                                                                                                                    |
| `SegmentedControl` / `Tabs`                                                                                               | POS order type, KDS Active/Bumped and stations, report tabs (scrollable when many), PIN/Email sign-in                                                                                                                                                              |
| `Toast` + `useToast`                                                                                                      | success after save, sync errors, "added to cart". `aria-live="polite"`, 4 s, never steals focus. POS `ScanToast` moves onto it                                                                                                                                     |
| `AlertDialog`                                                                                                             | confirm destructive actions (archive, refund, void, sign out of a till with an open shift)                                                                                                                                                                         |
| `Skeleton`                                                                                                                | lists, tables and menu while loading (>300 ms). `QueryState` gains a `skeleton` slot                                                                                                                                                                               |
| `Sheet`                                                                                                                   | phone cart, kiosk order sheet, admin side panels                                                                                                                                                                                                                   |
| `Tooltip`                                                                                                                 | icon-only buttons in the console                                                                                                                                                                                                                                   |
| `QuantityStepper`                                                                                                         | one component (POS, kiosk, web); size follows `--control-h`                                                                                                                                                                                                        |
| `OptionTile` (radio/checkbox card)                                                                                        | the three copies of the option tile; also payment-method and pickup/delivery cards                                                                                                                                                                                 |
| `ProductCard`                                                                                                             | storefront and kiosk (picture 4:3, name, description, price, add). A no-picture tile uses a category icon on `surface-sunken`, never an empty gap (today `ProductPicture` renders nothing). The demo seed gains sample pictures so demos and E2E show real layouts |
| `StatCard`, `DataTable` (sorting, sticky header, density, numeric alignment, bulk select), `Chart` (Recharts, admin only) | dashboard and reports; the org-level reports in E1                                                                                                                                                                                                                 |
| `StatusBadge`                                                                                                             | open/closed, order and sync status: colour plus icon plus text                                                                                                                                                                                                     |
| `PageShell`                                                                                                               | header, sidebar groups (collapsible, searchable), skip link and breadcrumbs for console apps                                                                                                                                                                       |

### 5.3 Pattern rules

- **Forms:**
  - Visible labels, with required fields marked `*`.
  - Hints at 14 px, and errors at 14 px under the field, linked with `aria-describedby`.
  - Validate on blur. After a failed submit, focus the first invalid field or an error summary.
  - Right input types (`tel`, `email`, `inputmode="numeric"` for PIN and codes).
- **Empty / loading / error:** a skeleton first. An empty state always says what to do next, with one action. An
  error states the cause and offers Retry.
- **Status:** never colour alone. Online/offline, sync and order states are an icon plus a word. POS sync
  problems escalate from the footer to a top banner.
- **Navigation:**
  - Console: a sidebar with collapsible groups and the active item highlighted; the location/brand switcher
    (enterprise, E1) at the top of the sidebar; the user menu in the header.
  - Storefront: header plus sticky category tabs with scroll-spy.
- **Motion:** only to show cause and effect (item flies to the cart badge, sheets slide from the bottom, KDS
  ticket arrives). Never decorative loops outside the kiosk attract screen, which stops on touch and under reduced
  motion.

## 6. Screen designs (mock-ups)

| Screen               | Before                                           | After                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website home         | `design-audit/web-desktop-dark-01-home.jpg`      | `design-mockups/after-web-home.jpg`: light storefront, picture hero, open status, two actions, picture cards with a no-picture fallback, "order from your phone" QR block, language and theme as icon menus |
| Website menu (phone) | `design-audit/web-phone-light-02-menu.jpg`       | `design-mockups/after-web-menu-phone.jpg`: branch status line, 44 px sticky category chips with active state, picture rows, sticky "View cart · ₪37.00" bar                                                 |
| Website checkout     | `design-audit/web-desktop-light-05-checkout.jpg` | `design-mockups/after-web-checkout.jpg`: step indicator, two-column form, sticky summary with pictures, promo code slot (E4), primary "Place order · total"                                                 |
| Kiosk attract        | `design-audit/kiosk-01-welcome.jpg`              | `design-mockups/after-kiosk-attract.jpg`: full-bleed welcome media (E6) with playlist dots, logo, 88 px start button, language pills                                                                        |
| Kiosk menu           | `design-audit/kiosk-02-menu.jpg`                 | `design-mockups/after-kiosk-menu.jpg`: portrait-first layout, category rail with pictures, two-column picture cards, bottom bar with total, "View order" and "Review and pay" (64 px)                       |
| Kiosk order and pay  | `design-audit/kiosk-05-checkout.jpg`             | `design-mockups/after-kiosk-pay.jpg`: bottom sheet with picture lines, 44 px steppers, large payment cards, 72 px "Pay ₪37.00"                                                                              |
| Buttons and colours  | —                                                | `design-mockups/after-spec-light.jpg`, `after-spec-dark.jpg`                                                                                                                                                |

**Kiosk landscape:** keep today's side cart, but with the new card, typography and target sizes. Choose the
layout from the screen's orientation, not a setting.

**Arabic:** every mock-up mirrors through logical properties, as the code does today. Check each screen in AR
when it is built (`design-audit/web-desktop-light-ar-01-home.jpg` shows today's mirroring works).

## 7. Accessibility bar (applies to every phase from E1)

- WCAG 2.2 AA:
  - text 4.5:1;
  - controls and focus 3:1;
  - focus visible and never hidden by sticky bars;
  - target size: 24 px minimum on the web console, 44 px storefront and POS, 64 px kiosk.
- Keyboard: every action is reachable. Dialogs and sheets trap focus and close on Esc. Focus moves to the page's
  `h1` on route change (the kiosk already does this).
- `prefers-reduced-motion` is respected everywhere, including spinners and the attract loop.
- Skip link in website, admin and platform admin.
- Text never below 12 px. Errors, prices and status never below 14 px.
- Status and errors are announced (`role="status"` / `aria-live`); toasts don't steal focus.

## 8. Rollout (no code in E0)

| Phase                             | Design work                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **E1** (organizations)            | `PageShell` with grouped sidebar and brand/location switcher, `StatCard`, `DataTable`, `Chart` for the org dashboard. Token additions (§4) land here because E1 is the first phase to need them. |
| **E2** (security, platform users) | Fix L1 (logo). Platform users screen built on `DataTable`, `AlertDialog`, `Toast`.                                                                                                               |
| **E3–E4** (online ordering)       | Cancel order and promo/tips UI on the new `OptionTile`, `Sheet`, `Toast`.                                                                                                                        |
| **E5** (POS alerts, reprint)      | New-order banner and sound settings, POS order history on `DataTable`. Fix P1–P3, P5.                                                                                                            |
| **E6** (website + kiosk)          | Full storefront redesign (W1–W11, K1–K7), welcome media, QR. Lighthouse accessibility ≥ 95.                                                                                                      |

Each phase runs the UI/UX Pro Max pre-delivery checklist on the screens it touches. Design debt left in a screen
goes into §2 of this file, not into a separate list.

## 9. Decisions (approved 2026-10-31)

1. **Storefront default theme:** light. Each tenant can still choose dark in Branding.
2. **Products without a picture:** every app shows the shared fallback tile (category icon on `surface-sunken`).
   POS keeps its per-till switch for pictures (ADR 0027).
3. **Charts:** Recharts in the admin only (roughly 100 kB gzipped), replacing the hand-built CSS chart.
