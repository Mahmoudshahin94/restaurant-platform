import { combinationName, newId, variantCombinations } from '@pos/domain';
import type { Product } from '@pos/validation';

/** One value of an option as edited: `key` follows it through renames and reordering. */
export interface ValueDraft {
  id?: string;
  key: string;
  nameEn: string;
  nameAr: string;
}

export interface OptionDraft {
  id?: string;
  key: string;
  nameEn: string;
  nameAr: string;
  values: ValueDraft[];
}

/**
 * A variant as edited. With options, it is one combination (`valueKeys`, one per option) that the
 * business sells or not (`enabled`); without, a size named by hand. Money stays as typed.
 */
export interface VariantDraft {
  id?: string;
  valueKeys: string[];
  enabled: boolean;
  nameEn: string;
  nameAr: string;
  sku: string;
  price: string;
  cost: string;
  trackInventory: boolean;
  /** The first is primary; the editor shows it, extra codes are kept as they are. */
  barcodes: string[];
}

const comboKey = (keys: readonly string[]) => keys.join('|');

/** An empty variant row priced like the product. */
export function blankVariant(price: string, valueKeys: string[] = []): VariantDraft {
  return {
    valueKeys,
    enabled: true,
    nameEn: '',
    nameAr: '',
    sku: '',
    price,
    cost: '',
    trackInventory: false,
    barcodes: [],
  };
}

/**
 * The matrix for the options as they are now: one row per combination of their values (first
 * option slowest), keeping the row already edited for a combination and adding a new one,
 * priced like the product, for each combination that is new. Without options, the rows are the
 * hand-named variants, unchanged.
 */
export function matrixRows(
  options: readonly OptionDraft[],
  rows: readonly VariantDraft[],
  price: string,
): VariantDraft[] {
  if (options.length === 0) return rows.filter((r) => r.valueKeys.length === 0);
  const byCombo = new Map(rows.map((r) => [comboKey(r.valueKeys), r]));
  return variantCombinations(options.map((o) => o.values.length)).map((combination) => {
    const keys = combination.map((value, option) => options[option]?.values[value]?.key ?? '');
    return byCombo.get(comboKey(keys)) ?? blankVariant(price, keys);
  });
}

/** The values a combination row stands for, in option order. */
export function rowValues(options: readonly OptionDraft[], row: VariantDraft): ValueDraft[] {
  return row.valueKeys.flatMap((key, i) => {
    const value = options[i]?.values.find((v) => v.key === key);
    return value ? [value] : [];
  });
}

/** How a combination row is labelled: its values' names, e.g. "M / Red". */
export function rowName(options: readonly OptionDraft[], row: VariantDraft) {
  return combinationName(rowValues(options, row));
}

export const newOption = (): OptionDraft => ({
  key: newId(),
  nameEn: '',
  nameAr: '',
  values: [newValue()],
});

export const newValue = (): ValueDraft => ({ key: newId(), nameEn: '', nameAr: '' });

/**
 * The editor's starting point for a product: its options (keyed by id), and its variants, plus,
 * with options, a row for every combination it does not sell yet (not enabled).
 */
export function draftOf(
  product: Product | null,
  toInput: (minor: number) => string,
): { options: OptionDraft[]; variants: VariantDraft[] } {
  if (!product) return { options: [], variants: [] };
  const options: OptionDraft[] = product.options.map((o) => ({
    id: o.id,
    key: o.id,
    nameEn: o.nameEn,
    nameAr: o.nameAr,
    values: o.values.map((v) => ({ id: v.id, key: v.id, nameEn: v.nameEn, nameAr: v.nameAr })),
  }));
  const variants: VariantDraft[] = product.variants.map((v) => ({
    id: v.id,
    valueKeys: v.optionValueIds,
    enabled: true,
    nameEn: v.nameEn,
    nameAr: v.nameAr,
    sku: v.sku ?? '',
    price: toInput(v.price),
    cost: v.cost === null ? '' : toInput(v.cost),
    trackInventory: v.trackInventory,
    barcodes: v.barcodes.map((b) => b.code),
  }));
  if (options.length === 0) return { options, variants };
  const matrix = matrixRows(options, variants, toInput(product.price)).map((row) =>
    row.id ? row : { ...row, enabled: false },
  );
  return { options, variants: matrix };
}

/**
 * The options and variants of the request (ADR 0021): option values by position, the variants
 * sold, each naming its value of every option by index. Money is converted by `toMinor`.
 */
export function catalogRequest(
  options: readonly OptionDraft[],
  variants: readonly VariantDraft[],
  toMinor: (input: string) => number,
) {
  const sold = variants.filter((v) => v.enabled);
  return {
    options: options.map((o) => ({
      ...(o.id ? { id: o.id } : {}),
      nameEn: o.nameEn.trim(),
      nameAr: o.nameAr.trim(),
      values: o.values.map((v) => ({
        ...(v.id ? { id: v.id } : {}),
        nameEn: v.nameEn.trim(),
        nameAr: v.nameAr.trim(),
      })),
    })),
    variants: sold.map((v, sortOrder) => ({
      ...(v.id ? { id: v.id } : {}),
      ...(options.length === 0 ? { nameEn: v.nameEn.trim(), nameAr: v.nameAr.trim() } : {}),
      optionValues: v.valueKeys.map((key, i) =>
        Math.max(0, options[i]?.values.findIndex((value) => value.key === key) ?? 0),
      ),
      sku: v.sku.trim() || null,
      price: toMinor(v.price),
      cost: v.cost.trim() === '' ? null : toMinor(v.cost),
      trackInventory: v.trackInventory,
      sortOrder,
      barcodes: v.barcodes
        .map((code) => code.trim())
        .filter((code) => code !== '')
        .map((code, i) => ({ code, isPrimary: i === 0 })),
    })),
  };
}
