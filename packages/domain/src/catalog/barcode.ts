import { BARCODE_MAX_LENGTH, BarcodeSymbology } from '@pos/shared-types';

/** Why a code is not a valid barcode of its symbology (`BARCODE_INVALID`, details.reason). */
export type BarcodeIssue =
  | 'EMPTY'
  | 'TOO_LONG'
  /** Only printable ASCII without spaces: what a scanner types. */
  | 'CHARACTERS'
  | 'NOT_DIGITS'
  | 'LENGTH'
  | 'CHECK_DIGIT';

const PRINTABLE = /^[!-~]+$/;
const DIGITS = /^\d+$/;

/** Digits of each GS1 code, check digit included. CODE128 and OTHER have no fixed length. */
const GTIN_LENGTH: Partial<Record<BarcodeSymbology, number>> = {
  [BarcodeSymbology.EAN13]: 13,
  [BarcodeSymbology.UPC_A]: 12,
  [BarcodeSymbology.EAN8]: 8,
};

/**
 * The GS1 check digit of the digits before it, the same for EAN-8, UPC-A and EAN-13: weights 3
 * and 1 alternate from the rightmost digit, and the check digit tops the sum up to a multiple
 * of 10.
 */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Whether the last digit of an all-digit code is the GS1 check digit of the others. */
export function hasValidCheckDigit(code: string): boolean {
  if (code.length < 2 || !DIGITS.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48;
}

/** What is wrong with `code` as a barcode of `symbology`, or null when it is valid. */
export function barcodeIssue(code: string, symbology: BarcodeSymbology): BarcodeIssue | null {
  if (code.length === 0) return 'EMPTY';
  if (code.length > BARCODE_MAX_LENGTH) return 'TOO_LONG';
  if (!PRINTABLE.test(code)) return 'CHARACTERS';
  const length = GTIN_LENGTH[symbology];
  if (length === undefined) return null;
  if (!DIGITS.test(code)) return 'NOT_DIGITS';
  if (code.length !== length) return 'LENGTH';
  return hasValidCheckDigit(code) ? null : 'CHECK_DIGIT';
}

/**
 * The symbology of a code typed without one: all digits of a GS1 length is that GS1 code (and
 * its check digit is then verified, so a mistyped EAN is caught rather than saved), anything
 * else CODE128.
 */
export function detectSymbology(code: string): BarcodeSymbology {
  if (DIGITS.test(code)) {
    for (const [symbology, length] of Object.entries(GTIN_LENGTH)) {
      if (code.length === length) return symbology as BarcodeSymbology;
    }
  }
  return BarcodeSymbology.CODE128;
}

/**
 * The codes a scan may stand for. A UPC-A is also printed and scanned as an EAN-13 with a leading
 * zero, so either form finds the other.
 */
export function barcodeCandidates(code: string): string[] {
  if (!DIGITS.test(code)) return [code];
  if (code.length === 12) return [code, `0${code}`];
  if (code.length === 13 && code.startsWith('0')) return [code, code.slice(1)];
  return [code];
}
