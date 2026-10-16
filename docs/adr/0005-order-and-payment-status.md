# ADR 0005: Separate payment status; kitchen-derived preparation status

- Status: Accepted (2026-10-17), implemented in Phases 2–4

## Decision

- `Order.status` follows the explicit state machine
  `DRAFT → PLACED → CONFIRMED → PREPARING → READY → COMPLETED`, plus `CANCELLED` and
  `REFUNDED`.
- `Order.paymentStatus` is separate (`UNPAID / PARTIALLY_PAID / PAID / PARTIALLY_REFUNDED /
REFUNDED`). Split payments and partial refunds do not fit a single status field. The order
  becomes `REFUNDED` only on a full refund.
- `COMPLETED` requires balance due = 0.
- `PREPARING` and `READY` are derived from kitchen tickets: the first ticket started gives
  `PREPARING`, and all tickets ready gives `READY`. Staff do not set them by hand.
