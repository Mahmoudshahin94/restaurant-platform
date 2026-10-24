import type { LocalizedName } from '../menu/types';

/** Why variants do not match their product's options (`INVALID_VARIANT_OPTIONS`, details.reason). */
export type VariantOptionsIssue =
  /** A variant names a different number of values than the product has options. */
  | 'WRONG_VALUE_COUNT'
  /** A value index is outside its option's values. */
  | 'UNKNOWN_VALUE'
  /** Two variants are the same combination. */
  | 'DUPLICATE_COMBINATION'
  /** An option has no values. */
  | 'EMPTY_OPTION';

/** Largest generated matrix: more combinations than this is a catalog, not a product. */
export const MAX_VARIANTS = 100;

/**
 * Every combination of one value of each option, as value indexes in option order, the first
 * option varying slowest (S·Red, S·Blue, M·Red, ...). No options: no combinations.
 */
export function variantCombinations(valueCounts: readonly number[]): number[][] {
  if (valueCounts.length === 0) return [];
  let combinations: number[][] = [[]];
  for (const count of valueCounts) {
    combinations = combinations.flatMap((prefix) =>
      Array.from({ length: count }, (_, value) => [...prefix, value]),
    );
  }
  return combinations;
}

/** The name of a combination in both languages: its values joined, e.g. "M / Red". */
export function combinationName(values: readonly LocalizedName[]): LocalizedName {
  return {
    nameEn: values.map((v) => v.nameEn).join(' / '),
    nameAr: values.map((v) => v.nameAr).join(' / '),
  };
}

/**
 * Checks the variants of a product with options: each is one value of every option, and no two
 * are the same combination. A product without options takes variants named by hand (no values).
 * Returns the first problem and the variant it was found at, or null.
 */
export function variantOptionsIssue(
  valueCounts: readonly number[],
  combinations: readonly (readonly number[])[],
): { reason: VariantOptionsIssue; index: number } | null {
  const emptyOption = valueCounts.findIndex((count) => count === 0);
  if (emptyOption >= 0) return { reason: 'EMPTY_OPTION', index: emptyOption };
  const seen = new Set<string>();
  for (const [index, combination] of combinations.entries()) {
    if (combination.length !== valueCounts.length) return { reason: 'WRONG_VALUE_COUNT', index };
    if (combination.some((value, option) => !(value >= 0 && value < (valueCounts[option] ?? 0)))) {
      return { reason: 'UNKNOWN_VALUE', index };
    }
    const key = combination.join(',');
    if (valueCounts.length > 0 && seen.has(key)) return { reason: 'DUPLICATE_COMBINATION', index };
    seen.add(key);
  }
  return null;
}
