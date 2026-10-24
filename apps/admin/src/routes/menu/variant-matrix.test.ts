import type { Product } from '@pos/validation';
import { describe, expect, it } from 'vitest';
import {
  type OptionDraft,
  blankVariant,
  catalogRequest,
  draftOf,
  matrixRows,
  rowName,
} from './variant-matrix';

const size: OptionDraft = {
  key: 'size',
  nameEn: 'Size',
  nameAr: 'المقاس',
  values: [
    { key: 's', nameEn: 'S', nameAr: 'صغير' },
    { key: 'm', nameEn: 'M', nameAr: 'وسط' },
  ],
};
const colour: OptionDraft = {
  key: 'colour',
  nameEn: 'Colour',
  nameAr: 'اللون',
  values: [
    { key: 'red', nameEn: 'Red', nameAr: 'أحمر' },
    { key: 'blue', nameEn: 'Blue', nameAr: 'أزرق' },
  ],
};
const minor = (input: string) => Math.round(Number(input) * 100);

describe('the variant matrix', () => {
  it('has a row for every combination, priced like the product', () => {
    const rows = matrixRows([size, colour], [], '60.00');
    expect(rows.map((r) => rowName([size, colour], r).nameEn)).toEqual([
      'S / Red',
      'S / Blue',
      'M / Red',
      'M / Blue',
    ]);
    expect(rows.every((r) => r.enabled && r.price === '60.00')).toBe(true);
    expect(rowName([size, colour], rows[3]!).nameAr).toBe('وسط / أزرق');
  });

  it('keeps edited rows when a value is added, and drops the rows of a removed one', () => {
    const rows = matrixRows([size, colour], [], '60.00');
    rows[0] = { ...rows[0]!, sku: 'TEE-S-RED', barcodes: ['6291234000018'] };
    const large = { ...size, values: [...size.values, { key: 'l', nameEn: 'L', nameAr: 'كبير' }] };
    const grown = matrixRows([large, colour], rows, '65.00');
    expect(grown).toHaveLength(6);
    expect(grown[0]).toMatchObject({ sku: 'TEE-S-RED', barcodes: ['6291234000018'] });
    expect(grown[5]).toMatchObject({ valueKeys: ['l', 'blue'], price: '65.00', sku: '' });

    const redOnly = { ...colour, values: [colour.values[0]!] };
    expect(matrixRows([large, redOnly], grown, '').map((r) => r.valueKeys)).toEqual([
      ['s', 'red'],
      ['m', 'red'],
      ['l', 'red'],
    ]);
  });

  it('keeps hand-named variants when there are no options', () => {
    const named = { ...blankVariant('6.00'), nameEn: 'Large', nameAr: 'كبير' };
    expect(matrixRows([], [named], '')).toEqual([named]);
  });
});

describe('the request', () => {
  it('sends the combinations sold, by value index, with SKU, money and codes', () => {
    const rows = matrixRows([size, colour], [], '60.00');
    rows[1] = { ...rows[1]!, enabled: false };
    rows[2] = { ...rows[2]!, sku: ' TEE-M-RED ', cost: '22.50', barcodes: ['6291234000032', ''] };
    const body = catalogRequest([size, colour], rows, minor);
    expect(body.options[1]).toEqual({
      nameEn: 'Colour',
      nameAr: 'اللون',
      values: [
        { nameEn: 'Red', nameAr: 'أحمر' },
        { nameEn: 'Blue', nameAr: 'أزرق' },
      ],
    });
    expect(body.variants.map((v) => [v.optionValues, v.sku, v.price, v.cost])).toEqual([
      [[0, 0], null, 6000, null],
      [[1, 0], 'TEE-M-RED', 6000, 2250],
      [[1, 1], null, 6000, null],
    ]);
    expect(body.variants[1]?.barcodes).toEqual([{ code: '6291234000032', isPrimary: true }]);
    expect(body.variants.map((v) => v.sortOrder)).toEqual([0, 1, 2]);
    expect('nameEn' in body.variants[0]!).toBe(false);
  });

  it('starts from a product: its options by id, and the combinations it does not sell yet', () => {
    const product = {
      price: 6000,
      options: [
        {
          id: 'o1',
          nameEn: 'Size',
          nameAr: 'المقاس',
          sortOrder: 0,
          values: [
            { id: 'v1', nameEn: 'S', nameAr: 'صغير', sortOrder: 0 },
            { id: 'v2', nameEn: 'M', nameAr: 'وسط', sortOrder: 1 },
          ],
        },
      ],
      variants: [
        {
          id: 'x1',
          nameEn: 'M',
          nameAr: 'وسط',
          sku: 'TEE-M',
          price: 6500,
          cost: 2000,
          trackInventory: true,
          sortOrder: 0,
          optionValueIds: ['v2'],
          barcodes: [
            { id: 'b1', code: '6291234000025', symbology: 'EAN13', isPrimary: true },
            { id: 'b2', code: 'TEE-M-OLD', symbology: 'CODE128', isPrimary: false },
          ],
          imageFileIds: [],
        },
      ],
    } as unknown as Product;
    const draft = draftOf(product, (m) => (m / 100).toFixed(2));
    expect(draft.variants.map((v) => [v.valueKeys, v.enabled, v.price])).toEqual([
      [['v1'], false, '60.00'],
      [['v2'], true, '65.00'],
    ]);
    expect(draft.variants[1]).toMatchObject({
      id: 'x1',
      sku: 'TEE-M',
      cost: '20.00',
      barcodes: ['6291234000025', 'TEE-M-OLD'],
    });
    const body = catalogRequest(draft.options, draft.variants, minor);
    expect(body.options[0]?.values.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(body.variants).toHaveLength(1);
    expect(body.variants[0]?.barcodes.map((b) => b.code)).toEqual(['6291234000025', 'TEE-M-OLD']);
  });
});
