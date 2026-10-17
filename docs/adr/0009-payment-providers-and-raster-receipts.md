# ADR 0009: Payment providers, externally approved cards and raster receipts

- Status: Accepted (2026-10-17)

## Context

Phase 3 adds payments, shifts and receipts. The first market is undecided, so there is no card
acquirer or payment gateway to integrate yet, and receipt printers vary by venue. Receipts must
print Arabic correctly; most thermal printers' built-in Arabic code pages do not shape letters
or lay out right-to-left lines.

## Decision

- **Provider abstraction.** Every payment goes through a `PaymentProvider` (create, authorize,
  capture, cancel, refund, status) picked by the method type from a registry. Three providers
  exist today:
  - `cash`: settles immediately; change and optional cash rounding come from `prepareCharge` in
    `@pos/domain`.
  - `external-card`: the card is approved on a standalone terminal and the cashier records the
    approval code. The reference is validated so it can never hold a card number (13–19 digits
    are rejected). No card data touches the system, which keeps it out of PCI scope.
  - `unconfigured-online`: fails explicitly (`PROVIDER_NOT_CONFIGURED`) until a real gateway is
    added. A gateway is a new provider; the payments service does not change.
- **Payments are append-only and idempotent.** The client-generated payment id is the
  idempotency key. Refunds are new rows linked to their charge. The order row is locked during a
  charge so concurrent terminals cannot over-pay.
- **An open shift is required to take payments.** Every payment and refund records the shift
  whose drawer it touched, so close-out reconciles exactly.
- **Cash rounding** is a per-location setting, off by default. It applies only to the cash
  payment that settles the balance, is stored as `roundingAdjustment`, and never changes the order
  total or tax.
- **Receipts are rendered as images.** `@pos/receipts` builds a printer-neutral document
  (text, rows, dividers, QR placeholders) with an extension hook for future e-invoicing (e.g.
  ZATCA). The POS draws it on a canvas, so the browser shapes Arabic and lays out RTL. It is then
  converted to a 1-bit bitmap and sent as an ESC/POS `GS v 0` raster job, followed by a feed and
  a cut. The Tauri shell sends the bytes over TCP (`print_raw`, ports 9100–9109, size-capped).
  Without a network printer the same image goes to the browser print dialog.

## Consequences

- Any ESC/POS raster-capable printer works, in any language, with no per-model code page
  configuration. Raster jobs are larger than text jobs (tens of kilobytes per receipt), which is
  fine on a LAN.
- Integrated card terminals and online gateways each need a provider implementation later. The
  data model already stores `provider` and `providerRef`.
- Until the location hub exists (Phase 5), printing is driven from the POS terminal. The hub's
  printer service will reuse the same encoder.
