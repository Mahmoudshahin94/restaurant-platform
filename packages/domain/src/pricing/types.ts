import type { DiscountType } from '@pos/shared-types';

/** A tax applied to a line or fee. Rates are basis points (1500 = 15%). */
export interface TaxRate {
  taxId: string;
  rateBps: number;
}

export interface PricingLineInput {
  lineId: string;
  /** Unit price in minor units, modifiers included. */
  unitPrice: number;
  quantity: number;
  taxes: readonly TaxRate[];
}

export interface PricingDiscountInput {
  discountId: string;
  type: DiscountType;
  /** Basis points for PERCENTAGE, minor units for FIXED. */
  value: number;
}

export interface PricingFeeInput {
  feeId: string;
  amount: number;
  taxes: readonly TaxRate[];
}

export interface PricingInput {
  /** Whether prices already include tax (per location configuration). */
  taxInclusive: boolean;
  lines: readonly PricingLineInput[];
  discounts?: readonly PricingDiscountInput[];
  fees?: readonly PricingFeeInput[];
}

export interface TaxAmount {
  taxId: string;
  amount: number;
}

export interface PricedLine {
  lineId: string;
  /** unitPrice × quantity. */
  gross: number;
  /** This line's share of order-level discounts. */
  discount: number;
  /** gross − discount. */
  net: number;
  tax: number;
  taxes: TaxAmount[];
  /** What the customer pays for this line: net + tax when exclusive, net when inclusive. */
  total: number;
}

export interface PricedDiscount {
  discountId: string;
  amount: number;
}

export interface PricedFee {
  feeId: string;
  amount: number;
  tax: number;
  taxes: TaxAmount[];
}

export interface TaxBreakdown {
  taxId: string;
  rateBps: number;
  /** Amount the tax was computed on (tax excluded). */
  taxableAmount: number;
  amount: number;
}

/** All amounts are integer minor units of the order currency. */
export interface OrderPricing {
  subtotal: number;
  discount: number;
  tax: number;
  fees: number;
  total: number;
  lines: PricedLine[];
  appliedDiscounts: PricedDiscount[];
  appliedFees: PricedFee[];
  taxBreakdown: TaxBreakdown[];
}
