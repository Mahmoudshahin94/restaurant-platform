# ADR 0002: Money as integer minor units; rates as basis points

- Status: Accepted (2026-10-17)

## Decision

- All monetary amounts are **integers in the minor unit** of the restaurant currency. The
  exponent comes from ISO 4217 (`currencyExponent()`): 2 for SAR/AED/USD, 3 for KWD/BHD/OMR/JOD.
  The restaurant currency is fixed at provisioning.
- Rates and percentages are integer **basis points** (10000 = 100%).
- Rounding is half away from zero on integer division (`divideRoundHalfUp`).
- Tax is computed **per line** on the post-discount line amount. Inclusive tax is
  `gross × bps / (10000 + bps)`.
- Order-level discounts are allocated across lines proportionally with the **largest-remainder**
  method (`allocateProportionally`), so parts always sum to the discount exactly.
- Every intermediate product is checked to be a safe integer, and overflow throws.
- Decimal strings from user input are parsed with string arithmetic (`parseDecimalToMinor`).
  Input with too many decimals is rejected, not rounded. Display uses
  `Intl.NumberFormat.format(decimalString)`, which never converts to a float.

## Consequences

The same pricing engine (`@pos/domain`, Phase 2) gives identical totals on POS, website and
backend. The backend recalculates and is authoritative.
