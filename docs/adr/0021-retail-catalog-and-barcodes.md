# ADR 0021: A generic option-and-variant catalog, barcodes unique per tenant, and scanning offline

- Status: Accepted (2026-10-24)

## Context

The catalog was a restaurant's: a product had a price and, at most, a few sizes named by hand
(`ProductVariant` = name + price). A supermarket sells thousands of items by their barcode; a
clothing store sells one T-shirt in many sizes and colours, each with its own SKU, label and cost.
MADAR must serve both from the same catalog, configured, without anything clothing- or
grocery-specific in the code ([migration plan](../madar/migration-plan.md), Phase M5), and a till
must keep scanning when the location hub has lost the cloud.

M2 listed the modules this phase gives meaning to (`BARCODE`, `PRODUCT_VARIANTS`, `INVENTORY`,
[ADR 0018](0018-feature-modules.md)); M3 gave tenants an isolated file storage
([ADR 0019](0019-branding-and-theme.md)).

## Decision

### Options and variants are generic

- **`ProductOption`** is an axis of one product (Size, Colour, Material, Weight…), localized like
  everything else ([ADR 0004](0004-localized-columns.md)). **`ProductOptionValue`** is one of its
  values (S, M, L). **`ProductVariantOptionValue`** says which value of each option a variant is.
  None of them knows what a size or a colour is.
- A product **with options** sells combinations: every variant is one value of each option, no
  two the same, and is named after its values ("M / Red", "وسط / أحمر"; `combinationName`).
  The admin shows the whole matrix (`variantCombinations`) and the owner ticks the combinations
  sold; the others are simply not variants.
- A product **without options** keeps the variants named by hand that existed before M5 (a
  cola's Regular and Large). They need no option values and nothing about them changed.
- **`ProductVariant`** gains `sku`, `cost` (minor units, never published) and `trackInventory`.
  Variants are still archived, never deleted, because order lines name them.
- **Options and values are deleted** when removed, not archived: order lines keep the variant's
  name, and nothing else refers to them. Removing a value archives the variants that used it.
- **`ProductImage`** attaches a tenant file (`PRODUCT_IMAGE`: PNG, JPEG or WebP up to 2 MB, in the
  M3 storage under `tenants/<tid>/`) to a product or one variant. Pictures stay in the cloud for
  now: no screen at a location shows them, and their bytes would bloat every hub snapshot. The
  kiosk (M6) and the website (M7) decide what travels.

Writing a product's options and variants in one request needs a way to name values that do not
exist yet: a variant sends **`optionValues`, the index of its value in each option** of the same
request (`options` is only accepted together with `variants`). Existing options and values are
matched by id, so a rename keeps the variants that use the value.

### Barcodes

- **`ProductBarcode`**: tenant, product, optional variant, `code`, `symbology` (`EAN13`, `EAN8`,
  `UPC_A`, `CODE128`, `OTHER`, text with a check constraint) and `isPrimary`.
  - Unique per **(tenant, code)** in the database: a scan names exactly one thing to sell. Two
    tenants may sell the same can.
  - A product with variants is scanned by its variants' codes; product-level codes belong to
    products without variants (`BARCODE_INVALID`, `reason: VARIANT_REQUIRED`).
  - One primary code per product or variant (a partial unique index): the code printed on labels
    and kept on order lines that were not scanned.
  - A code taken by another item answers `409 BARCODE_TAKEN`; moving a code between variants of
    the same product in one save is allowed. An archived variant's codes are freed.
- **Check digits** are verified in `@pos/domain` (`gtinCheckDigit`, `barcodeIssue`), the same
  rule in the admin as the owner types, in request validation and on the server. A code without a
  symbology is detected (`detectSymbology`): all digits of a GS1 length (8, 12, 13) is that GS1
  code, so a mistyped EAN is caught instead of being saved as CODE128. Codes are printable ASCII
  without spaces, at most 64 characters (also a database check).
- **SKUs** name one thing too: unique in the tenant across products and live variants
  (`409 SKU_TAKEN`). Product SKUs were already unique in the database; variants carry no tenant
  column, so the catalog service checks theirs.
- **Order lines** keep `sku` (the variant's, else the product's) and `barcode` (the code scanned,
  else the item's primary code). A scanned code must belong to the line's item
  (`404 BARCODE_NOT_FOUND`, `reason: NOT_ON_ITEM`); `validateSelection` checks it, so the POS
  preview, the hub and the cloud agree.

### Lookup, on the cloud, the hub and the till

- **`lookupCode(menu, code)`** (`@pos/domain`) finds what a code names on a location's
  resolved menu: barcodes first (a UPC-A also as its EAN-13 form with a leading zero), then SKUs.
  Sold-out items are found too, so the screen can say why they cannot be sold.
- **`GET /locations/:lid/catalog/lookup?code=`** serves it on the cloud and the hub
  (`products.view`, gated by `BARCODE`: `403 FEATURE_DISABLED` when off). The route inventory and
  the security suite include it.
- **The published menu carries the codes** (`barcodes` on products without variants and on
  variants, and each variant's `sku`), so the POS looks codes up in its own copy of the menu:
  scanning needs neither the cloud nor a request to the hub. **Without `BARCODE` the menu has no
  codes** (its version changes), so nothing can be scanned and nothing leaks to screens that
  should not offer it.
- **The hub** gets options, values, combinations and barcodes in its snapshot (format **5**).
  They are replaced wholesale on apply: a code the cloud moved to another item is a new row with
  the same code, which an upsert by id would collide with. The change feed covers the four tables
  (`change_log_tenant` learned two lookups, through an option and through a variant).

### Modules decide what the catalog offers

- `PRODUCT_VARIANTS`: option axes and the matrix. Hand-named variants are part of the basic
  catalog (a coffee shop's sizes) and stay available without it.
- `BARCODE`: product and variant codes, the lookup route, codes in the published menu, scanning
  at the till.
- `INVENTORY`: only the `trackInventory` flag for now. **The stock ledger (quantities, movements,
  counts, low-stock) is a later phase**; the flag is stored and edited, and nothing counts stock
  yet.
- New option axes and new codes are refused with the module off (`403 FEATURE_DISABLED`); what
  is already stored may be sent back unchanged, so a product stays editable after a module is
  switched off. The admin hides what is off (and modifier groups without `MODIFIERS`, kitchen
  stations without `KDS`).

### Scanner abstraction

`@pos/app-kit/scanner`:

- `ScannerSource` (`kind`, `available`, `start(listener) → stop`) and `ScanEvent` (`code`,
  `source`, `at`).
- **`KeyboardWedgeScanner`**: USB and Bluetooth scanners type the code as keyboard input and press
  Enter. Keys are watched in the capture phase, never blocked. A burst of at least `minLength`
  (4) characters, each within `maxKeyIntervalMs` (35 ms) of the previous one, ending in a
  terminator (`Enter`) is a scan: the terminator is stopped (no form submitted, no button
  pressed) and a field the burst typed into gets its previous text back. Slower typing,
  modifier keys and anything inside `[data-scanner-ignore]` are left alone.
- **`ManualEntry`**: a code typed by a person, reported like a scan.
- **`NativeScanner`**: a placeholder (never available) for a camera or a scanner reached through
  the Tauri shell or WebHID.
- **`useBarcodeScanner(onScan, { enabled, wedge, sources })`**: listens to the scanners while
  enabled (the POS pauses them while a dialog is open) and always reports `submit(code)`.

At the POS (where `BARCODE` is on), a scan is looked up in the till's menu and the item goes into
the cart with its default options; it opens the options dialog only when a choice is required (a
modifier group with a minimum). Scanning the same item again adds one to its line. An unknown or
sold-out code shows a toast. "Enter barcode" next to the search opens manual entry.

## Consequences

- One catalog serves a restaurant's sizes, a supermarket's barcoded items and a clothing store's
  size × colour matrix; nothing in the code knows which is which.
- A till scans with the hub offline and with the cloud unreachable; the hub test does it with the
  cloud stopped, the E2E scenario 23 through the POS.
- The published menu grows by the codes of every item. A store with tens of thousands of items
  will want a code index on the till instead of a linear scan; `lookupCode` is linear today
  (fine for thousands).
- Variant SKU uniqueness is a service check, not a database constraint, so two concurrent saves
  could both pass. Admin edits are rare; a `tenant_id` on variants would close it if needed.
- The scanner's timing defaults suit common HID scanners; a slow Bluetooth scanner may need a
  larger `maxKeyIntervalMs` (configurable, not yet a device setting).
- Not done here: the stock ledger, label printing, scale (weight-embedded) barcodes, product
  pictures on screens, and a native scanner.
