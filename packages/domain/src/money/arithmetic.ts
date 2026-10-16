import { DomainError } from '../errors';
import { currencyExponent } from './currency';

/**
 * Money is always an integer number of minor units (e.g. 18.50 SAR = 1850). These helpers
 * never use fractional JavaScript numbers: every intermediate value is a safe integer, and
 * decimal strings are parsed/printed with string arithmetic.
 */

/** Basis points: 10000 = 100%, 1500 = 15%. Used for tax rates and percentage discounts. */
export const BPS_DENOMINATOR = 10_000;

export function assertMinorUnits(amount: number, label = 'amount'): void {
  if (!Number.isSafeInteger(amount)) {
    throw new DomainError('INVALID_MONEY_AMOUNT', `${label} must be a safe integer`, {
      [label]: amount,
    });
  }
}

/**
 * Integer division rounded half away from zero. Both arguments must be safe integers and the
 * denominator positive.
 */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  assertMinorUnits(numerator, 'numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new DomainError('INVALID_MONEY_AMOUNT', 'denominator must be a positive safe integer', {
      denominator,
    });
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const quotient = Math.floor(abs / denominator);
  const remainder = abs - quotient * denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
  return sign * rounded;
}

function safeMultiply(a: number, b: number): number {
  const product = a * b;
  if (!Number.isSafeInteger(product)) {
    throw new DomainError('INVALID_MONEY_AMOUNT', 'Money overflow', { a, b });
  }
  return product;
}

export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertMinorUnits(amount);
    total += amount;
  }
  assertMinorUnits(total, 'total');
  return total;
}

export function multiplyMinor(amount: number, quantity: number): number {
  assertMinorUnits(amount);
  assertMinorUnits(quantity, 'quantity');
  return safeMultiply(amount, quantity);
}

/** `amount × bps / 10000`, rounded half-up. E.g. 15% of 1999 = 300. */
export function applyBps(amount: number, bps: number): number {
  assertMinorUnits(amount);
  assertMinorUnits(bps, 'bps');
  return divideRoundHalfUp(safeMultiply(amount, bps), BPS_DENOMINATOR);
}

/**
 * The tax portion contained in a tax-inclusive gross amount:
 * `gross × rate / (1 + rate)` = `gross × bps / (10000 + bps)`, rounded half-up.
 */
export function inclusiveTaxPortion(gross: number, bps: number): number {
  assertMinorUnits(gross, 'gross');
  assertMinorUnits(bps, 'bps');
  return divideRoundHalfUp(safeMultiply(gross, bps), BPS_DENOMINATOR + bps);
}

/**
 * Splits `total` across `weights` proportionally using the largest-remainder method, so the
 * parts always sum exactly to `total`. Used to spread an order-level discount over lines.
 * Ties go to the earlier index, which keeps the result deterministic.
 */
export function allocateProportionally(total: number, weights: readonly number[]): number[] {
  assertMinorUnits(total, 'total');
  if (weights.length === 0) return [];
  weights.forEach((w, i) => {
    assertMinorUnits(w, `weights[${i}]`);
    if (w < 0) {
      throw new DomainError('INVALID_MONEY_AMOUNT', 'Weights must be non-negative', { index: i });
    }
  });
  const weightSum = sumMinor(weights);
  if (weightSum === 0) return weights.map(() => 0);

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  const parts = weights.map((w) => {
    const scaled = safeMultiply(absTotal, w);
    const base = Math.floor(scaled / weightSum);
    return { base, remainder: scaled - base * weightSum };
  });
  let leftover = absTotal - sumMinor(parts.map((p) => p.base));
  const order = parts
    .map((p, index) => ({ index, remainder: p.remainder }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const result = parts.map((p) => p.base);
  for (const { index } of order) {
    if (leftover === 0) break;
    result[index] = (result[index] ?? 0) + 1;
    leftover -= 1;
  }
  return result.map((r) => r * sign);
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a decimal string such as "18.5" into minor units for the currency (1850 for SAR,
 * 18500 for KWD). Rejects more fractional digits than the currency allows instead of rounding,
 * so user input is never silently changed.
 */
export function parseDecimalToMinor(value: string, currency: string): number {
  const exponent = currencyExponent(currency);
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    throw new DomainError('INVALID_MONEY_AMOUNT', 'Not a decimal amount', { value });
  }
  const [, negative, whole = '0', fraction = ''] = match;
  if (fraction.length > exponent) {
    throw new DomainError('INVALID_MONEY_AMOUNT', 'Too many decimal places for currency', {
      value,
      currency,
      maxDecimals: exponent,
    });
  }
  const digits = `${whole}${fraction.padEnd(exponent, '0')}`;
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor)) {
    throw new DomainError('INVALID_MONEY_AMOUNT', 'Amount too large', { value });
  }
  return negative && minor !== 0 ? -minor : minor;
}

/** Formats minor units as a plain decimal string ("18.50"); locale formatting lives in @pos/i18n. */
export function formatMinorAsDecimal(amount: number, currency: string): string {
  assertMinorUnits(amount);
  const exponent = currencyExponent(currency);
  const negative = amount < 0;
  const digits = String(Math.abs(amount));
  if (exponent === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(exponent + 1, '0');
  const whole = padded.slice(0, -exponent);
  const fraction = padded.slice(-exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
