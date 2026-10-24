import { BarcodeSymbology } from '@pos/shared-types';
import { describe, expect, it } from 'vitest';
import {
  barcodeCandidates,
  barcodeIssue,
  detectSymbology,
  gtinCheckDigit,
  hasValidCheckDigit,
} from './barcode';
import { combinationName, variantCombinations, variantOptionsIssue } from './variants';

describe('GS1 check digits', () => {
  it.each([
    // EAN-13, UPC-A and EAN-8 share one rule: weights 3,1 from the right, up to a multiple of 10.
    ['400638133393', 1],
    ['629100000001', 3],
    ['03600029145', 2],
    ['9638507', 4],
    ['000000000000', 0],
  ])('the check digit of %s is %i', (body, digit) => {
    expect(gtinCheckDigit(body)).toBe(digit);
  });

  it('accepts a correct check digit and refuses any other', () => {
    expect(hasValidCheckDigit('4006381333931')).toBe(true);
    expect(hasValidCheckDigit('4006381333932')).toBe(false);
    expect(hasValidCheckDigit('036000291452')).toBe(true);
    expect(hasValidCheckDigit('96385074')).toBe(true);
    expect(hasValidCheckDigit('ABC')).toBe(false);
    expect(hasValidCheckDigit('7')).toBe(false);
  });
});

describe('barcodeIssue', () => {
  it.each([
    ['4006381333931', BarcodeSymbology.EAN13, null],
    ['4006381333930', BarcodeSymbology.EAN13, 'CHECK_DIGIT'],
    ['400638133393', BarcodeSymbology.EAN13, 'LENGTH'],
    ['40063813339X1', BarcodeSymbology.EAN13, 'NOT_DIGITS'],
    ['036000291452', BarcodeSymbology.UPC_A, null],
    ['036000291453', BarcodeSymbology.UPC_A, 'CHECK_DIGIT'],
    ['96385074', BarcodeSymbology.EAN8, null],
    ['96385075', BarcodeSymbology.EAN8, 'CHECK_DIGIT'],
    ['TEE-RED-M', BarcodeSymbology.CODE128, null],
    ['12345', BarcodeSymbology.OTHER, null],
    ['', BarcodeSymbology.CODE128, 'EMPTY'],
    ['TEE RED', BarcodeSymbology.CODE128, 'CHARACTERS'],
    ['قميص', BarcodeSymbology.OTHER, 'CHARACTERS'],
    ['X'.repeat(65), BarcodeSymbology.CODE128, 'TOO_LONG'],
  ])('%s as %s → %s', (code, symbology, issue) => {
    expect(barcodeIssue(code, symbology)).toBe(issue);
  });
});

describe('detectSymbology', () => {
  it('reads GS1 lengths as GS1 codes, whatever their check digit', () => {
    expect(detectSymbology('4006381333931')).toBe('EAN13');
    expect(detectSymbology('036000291452')).toBe('UPC_A');
    expect(detectSymbology('96385074')).toBe('EAN8');
    // A mistyped EAN stays an EAN, so its check digit is verified instead of it being saved.
    const typo = '4006381333930';
    expect(barcodeIssue(typo, detectSymbology(typo))).toBe('CHECK_DIGIT');
  });

  it('takes anything else as CODE128', () => {
    expect(detectSymbology('TEE-RED-M')).toBe('CODE128');
    expect(detectSymbology('12345')).toBe('CODE128');
  });
});

describe('barcodeCandidates', () => {
  it('finds a UPC-A from its EAN-13 form and back', () => {
    expect(barcodeCandidates('036000291452')).toEqual(['036000291452', '0036000291452']);
    expect(barcodeCandidates('0036000291452')).toEqual(['0036000291452', '036000291452']);
    expect(barcodeCandidates('4006381333931')).toEqual(['4006381333931']);
    expect(barcodeCandidates('TEE-1')).toEqual(['TEE-1']);
  });
});

describe('variant combinations', () => {
  it('combines one value of each option, the first option varying slowest', () => {
    expect(variantCombinations([3, 2])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
    ]);
    expect(variantCombinations([2])).toEqual([[0], [1]]);
    expect(variantCombinations([])).toEqual([]);
    expect(variantCombinations([2, 0])).toEqual([]);
  });

  it('names a combination in both languages', () => {
    expect(
      combinationName([
        { nameEn: 'M', nameAr: 'وسط' },
        { nameEn: 'Red', nameAr: 'أحمر' },
      ]),
    ).toEqual({ nameEn: 'M / Red', nameAr: 'وسط / أحمر' });
  });

  it('accepts any subset of the combinations, and name-only variants without options', () => {
    expect(
      variantOptionsIssue(
        [3, 2],
        [
          [0, 1],
          [2, 0],
        ],
      ),
    ).toBeNull();
    expect(variantOptionsIssue([], [[], []])).toBeNull();
  });

  it('finds variants that do not match the options', () => {
    expect(variantOptionsIssue([3, 2], [[0]])).toEqual({ reason: 'WRONG_VALUE_COUNT', index: 0 });
    expect(
      variantOptionsIssue(
        [3, 2],
        [
          [0, 0],
          [0, 2],
        ],
      ),
    ).toEqual({
      reason: 'UNKNOWN_VALUE',
      index: 1,
    });
    expect(
      variantOptionsIssue(
        [3, 2],
        [
          [1, 1],
          [1, 1],
        ],
      ),
    ).toEqual({
      reason: 'DUPLICATE_COMBINATION',
      index: 1,
    });
    expect(variantOptionsIssue([3, 0], [])).toEqual({ reason: 'EMPTY_OPTION', index: 1 });
  });
});
