# ADR 0022: Terminals pair with their hub, and the kiosk is a thin client of the order engine

- Status: Accepted (2026-10-24)

## Context

MADAR's businesses want customers to serve themselves: a burger place's ordering kiosk sends
orders to its kitchen, a supermarket's self-checkout sells what the customer scans
([migration plan](../madar/migration-plan.md), Phase M6). M2 already named the module
(`SELF_CHECKOUT`, [ADR 0018](0018-feature-modules.md)), M3 a `kiosk` branding surface
([ADR 0019](0019-branding-and-theme.md)), M4 the languages a screen offers
([ADR 0020](0020-currency-and-localization.md)) and M5 the scanner and barcodes
([ADR 0021](0021-retail-catalog-and-barcodes.md)).

Three things made it more than a new screen:

- **A kiosk has no cashier.** The POS and KDS sign in as staff; nobody signs a kiosk in. It needs
  an identity of its own, and that identity must be able to do much less than any staff member.
- **The location runs offline** ([ADR 0001](0001-location-hub-owns-sqlite.md)). The kiosk must
  keep selling while the hub has lost the cloud, so it must be set up and authenticated by the
  hub, not the cloud.
- **No second order engine.** Prices, taxes, availability, the state machine, kitchen tickets and
  payments already exist once, shared by the cloud and the hub. A kiosk that re-implemented any of
  them would drift.

## Decision

### Terminals pair with their location hub

- **`DeviceType.KIOSK`** joins the device types. POS, KDS, KIOSK and CUSTOMER_DISPLAY are
  _terminals_ (`TERMINAL_DEVICE_TYPES`): screens a hub pairs and authenticates. The hub itself
  (`GATEWAY`) still pairs with the cloud, unchanged.
- **The admin creates the terminal** (Devices → Add a device): it is stored `PENDING` with a
  one-time **pairing code** of 8 characters from an unambiguous alphabet (`ABCD-EFGH`), shown
  once, valid for 24 hours, renewable while pending (`POST …/devices/:id/pairing-code`). Only the
  code's SHA-256 is stored.
- **The hub pairs it, offline if need be.** The code's hash and expiry ride the snapshot (format
  **6**); a change-feed trigger on `devices` (ignoring what devices report: last contact, version,
  metadata, credential) announces new and disabled terminals. Typed on the terminal,
  `POST /terminals/pair` (public, rate-limited like sign-in, refused until the hub is provisioned)
  issues the terminal's credential `<deviceId>.<secret>`, returned once; **its hash lives on the
  hub only**. The code is single use: the hub clears it, and its snapshot merge never stores a used
  code again.
- **The cloud hears of it through the outbox.** The hub writes a `DEVICE_UPSERT` operation (status,
  `pairedAt`, `lastSeenAt`, `appVersion`; never a credential or code) when a terminal pairs, when
  its app version changes and, at most every five minutes, as it keeps working. The cloud only moves
  a terminal from `PENDING` to `ACTIVE`, never brings back one an administrator disabled, keeps the
  latest contact, and refuses a report about another location's device. An order whose payment
  names the terminal waits for the terminal's report (a sync dependency).
- **The lifecycle only moves forward on the hub** (`PENDING` < `ACTIVE` < `DISABLED`): a snapshot
  taken before the cloud heard of a pairing keeps the terminal paired, and the cloud's disabling
  wins and drops the credential, so a lost kiosk is locked out with the next snapshot.
- **Devices report their version** in `x-madar-client-version` on every request (`Device.appVersion`,
  shown in the admin); Phase M10 builds release tracking on it.
- **The device configuration layer is fed by real devices now.** A terminal's requests carry its
  device id in their scope, so modules resolve with `FeatureOverride`s of the device
  (`PUT /tenants/:tid/features/:f` with `deviceId`).

### A narrow principal: device routes

- **`@DeviceRoute(...types)`** marks a route served to terminal credentials of those types, and to
  nobody else. The route inventory has a new access class, `device`, with the types; a route
  cannot be both a device route and a staff route (start-up refuses it).
- The global auth guard authenticates `Authorization: Device …` on device routes only, against the
  hub's own device rows (`TerminalAuthService`): an `ACTIVE` terminal of the route's types whose
  credential matches. A staff token there is refused (`401`); a device credential on any staff
  route is refused (`401`, it carries no bearer token). The permissions guard checks that a route's
  `:locationId` (and `:tenantId`) is the device's own (`404` otherwise).
- **A kiosk may do exactly this** (all hub routes, `KioskModule`):

  | Route                                                 | What                                   | Module          |
  | ----------------------------------------------------- | -------------------------------------- | --------------- |
  | `GET /kiosk/context`                                  | identity, location, tenant context     | —               |
  | `GET /locations/:lid/kiosk/menu`                      | the published menu (ETag)              | `SELF_CHECKOUT` |
  | `POST /locations/:lid/kiosk/orders`                   | place its own order                    | `SELF_CHECKOUT` |
  | `POST /locations/:lid/kiosk/orders/:orderId/payments` | the payment intent (card terminal)     | `SELF_CHECKOUT` |
  | `POST /locations/:lid/kiosk/orders/:orderId/cancel`   | give up an unpaid order of its own     | `SELF_CHECKOUT` |
  | `POST /kiosk/attendant`                               | staff leave the customer screens (PIN) | —               |
  | `GET /terminals/me` (every terminal type)             | whether its credential still works     | —               |

  The context and the attendant exit work with `SELF_CHECKOUT` off, so the kiosk can say so and
  staff can still get out. A kiosk sees only orders it created (its first status change names it);
  another kiosk's or the POS's orders are not found.

- **Attendant exit** reuses the POS's PIN check (`AuthService.verifyPin`, locked after five wrong
  PINs) and requires a new permission, **`kiosk.attend`**, at the kiosk's location. No staff
  session is issued; the kiosk only opens its attendant menu (back to customers, reload the menu,
  full screen, unpair). It is audited (`kiosk.attendant_opened`).

### One order engine

- **`OrdersService.create` takes an actor**: a staff principal or a device actor. A kiosk's order
  is created by the same code as the POS's, with channel **`KIOSK`** and source **`KIOSK`** (new
  values of both enums), priced by the same domain engine from the hub's menu (client totals are
  never read), with scanned barcodes checked against their items (ADR 0021). Its status history
  and audit name the device (`actorType DEVICE`); `createdById` is null. A device cannot apply
  discounts. Staff cannot create `KIOSK` orders (`staffOrderChannelSchema`); the POS edits one as
  takeaway, like a website order.
- **Every kiosk order is placed `PLACED` and unpaid**, whichever way it will be paid:
  - **Paid at the kiosk:** the payment intent charges the kiosk's card terminal. Once the order is
    paid, the platform moves it on with **SYSTEM rules** of the state machine (new):
    `PLACED → CONFIRMED` (requires paid) — kitchen tickets are made where `KDS` is on, exactly as
    for the POS — and, where there is no kitchen screen, `CONFIRMED → COMPLETED` (requires paid):
    a supermarket's self-checkout hands the goods over at once (`selfServicePath`). The decision
    follows the `KDS` module, never the business type.
  - **Pay at the counter:** the order waits, `PLACED`. The POS shows "kiosk orders to collect"
    (where `SELF_CHECKOUT` is on); the cashier takes the money with the POS's own payment and
    confirms it (`PLACED → CONFIRMED`, a staff transition).
  - A declined card leaves the order `PLACED`; the customer retries (a new payment id), pays at the
    counter instead, or gives up (the kiosk cancels its own unpaid order, reason
    `KIOSK_CANCELLED`, a SYSTEM transition). The idle reset gives up the same way.
- Order and payment ids are client-generated idempotency keys, as everywhere: a resend after a lost
  answer returns the same order, and the same payment id never charges twice; a retry also
  finishes the status steps a lost answer left undone.

### Payments: an integrated card terminal

- **`PaymentTerminalProvider`** (extends `PaymentProvider`, method `CARD`): `chargeAtTerminal`
  asks the card reader of a device to take an amount and resolves with the outcome and its
  approval code. `PAYMENT_TERMINAL_PROVIDER` chooses the adapter: `none` (kiosk card payments are
  refused: pay at the counter) or `mock`, the documented test adapter that approves every charge
  (refused in production, like the online mock). A vendor's SDK becomes another value.
- **`PaymentsService.chargeAtTerminal`** asks the terminal first, **outside any transaction** (a
  customer tapping a card holds no lock, and the hub's single SQLite writer stays free), then
  records the outcome under the order's row lock. If the order changed meanwhile (a cashier took
  the money), the terminal's charge is voided and the payment refused. Declines are recorded
  (`FAILED`), like any provider outcome. The payment is recorded under the tenant's first card
  method.
- **Drawer-less card payments:** `payments.device_id` names the terminal that took the payment,
  and the CHECK becomes `shift_id IS NOT NULL OR method_type = 'ONLINE' OR (method_type = 'CARD'
AND device_id IS NOT NULL)`. Every other payment still belongs to a cashier's shift. Payments
  stay append-only; a refund at the POS goes back through the provider that took the charge (the
  registry finds it by the payment's `provider` name).

### The kiosk app

`apps/kiosk` (Vite + React, port 5176 in development, served like the KDS) is a LAN client of its
hub with `@pos/api-client`'s kiosk client: no staff session, ever.

- **Unpaired:** the pairing screen, in the business's kiosk branding read from the hub's public
  branding. The credential is kept in the device's storage; a `401` from the hub (disabled) brings
  the pairing screen back.
- **Paired:** the tenant's kiosk surface branding, money and languages (`TenantContextProvider`
  with the kiosk's context). Without `SELF_CHECKOUT` it says self-service is unavailable.
- **The visit:** a welcome screen (languages as large buttons, each named in its own language), the
  menu by category as large tiles, an options sheet whose validity and price come from
  `validateSelection`, the order beside it priced by `quoteOrder`, checkout (an optional name to
  call, card or counter), the card terminal screen, and the order number. Where `BARCODE` is on,
  the M5 scanner adds items (`useBarcodeScanner` over `lookupCode` on the kiosk's copy of the
  menu), even from the welcome screen, and a code can be typed.
- **Idle reset:** after a minute without a touch, a key or a scan, "Are you still there?" counts
  down 15 seconds, then the visit is wiped (an order left unpaid at the terminal is cancelled). The
  order-number screen returns to the welcome screen after 20 seconds. Nothing of a visit (order,
  language, name, text size) survives it.
- **Accessibility:** touch targets of at least 56 px, focus moved to each step's heading, a polite
  live region announcing what was added or removed, "Larger text" (the root font scales by 125%),
  reduced motion respected, Arabic right to left with numbers kept left to right.

## Consequences

- A kiosk can read the menu, place and pay its own orders, and nothing else; the security suite
  walks every staff route with a kiosk's credential and every device route with staff tokens.
- Kiosks keep selling, and can even be paired, with the hub's internet down; the cloud catches up
  through the outbox. Disabling a kiosk in the admin locks it out once its hub has the next
  snapshot (seconds when online; offline, when the hub reconnects).
- The order, pricing, kitchen and payment rules have one implementation for the POS, the website
  and the kiosk. The kiosk-specific code is the UI and a thin controller.
- POS, KDS and customer-display terminals can be paired today (identity, contact, version, device
  modules), but those apps still sign in as staff; adopting the device credential there belongs to
  Phase M10 with version reporting.
- Not done here: a real card-terminal SDK, receipts printed at the kiosk, kiosk-specific menus or
  pictures (product images stay in the cloud, ADR 0021), loyalty, an "eat in / take away" choice,
  and a customer display.
