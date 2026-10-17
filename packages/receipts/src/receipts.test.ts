import type { Order } from '@pos/validation';
import { describe, expect, it } from 'vitest';
import { buildReceipt } from './document';
import { encodeRasterJob, rgbaToMonoBitmap } from './escpos';

const order = {
  orderNumber: 'MAIN-007',
  channel: 'DINE_IN',
  createdAt: '2026-10-17T09:30:00.000Z',
  tableLabel: 'T4',
  customerName: null,
  currencyCode: 'SAR',
  taxInclusive: true,
  subtotal: 5850,
  feeTotal: 0,
  total: 5265,
  balanceDue: 0,
  discounts: [
    {
      discountId: 'd',
      nameEn: '10% off',
      nameAr: 'خصم 10%',
      type: 'PERCENTAGE',
      value: 1000,
      amount: 585,
    },
  ],
  taxes: [
    {
      taxId: 't',
      nameEn: 'VAT',
      nameAr: 'ضريبة القيمة المضافة',
      rateBps: 1500,
      taxableAmount: 4578,
      amount: 687,
    },
  ],
  items: [
    {
      nameEn: 'Classic Burger',
      nameAr: 'برجر كلاسيك',
      variantNameEn: null,
      variantNameAr: null,
      quantity: 2,
      gross: 5000,
      notes: 'No onions',
      modifiers: [{ nameEn: 'Medium', nameAr: 'متوسط' }],
    },
  ],
  payments: [
    {
      type: 'CHARGE',
      status: 'CAPTURED',
      methodNameEn: 'Cash',
      methodNameAr: 'نقدًا',
      amount: 5265,
      tendered: 6000,
      change: 735,
      roundingAdjustment: 0,
      reference: null,
    },
  ],
} as unknown as Order;

const t = (key: string, o?: Record<string, unknown>) => `${key}${o ? JSON.stringify(o) : ''}`;
const context = {
  order,
  restaurant: { nameEn: 'Demo Kitchen', nameAr: 'مطبخ تجريبي' },
  location: {
    nameEn: 'Main',
    nameAr: 'الرئيسي',
    addressLine: 'King Fahd Rd',
    phone: null,
    timezone: 'Asia/Riyadh',
  },
  cashierName: 'Sara',
  printedAt: '2026-10-17T09:35:00.000Z',
  t,
};

describe('buildReceipt', () => {
  it('lays out header, lines, totals and cash change', () => {
    const doc = buildReceipt({ ...context, locale: 'en' });
    // Intl separates currency and amount with a no-break space; compare with plain spaces.
    const plain = (s: string) => s.replace(/\u00a0/g, ' ');
    const rows = doc.blocks.flatMap((b) =>
      b.kind === 'row' ? [[plain(b.start), plain(b.end)]] : [],
    );
    expect(doc.direction).toBe('ltr');
    expect(rows).toContainEqual(['2 × Classic Burger', 'SAR 50.00']);
    expect(rows).toContainEqual(['10% off', '-SAR 5.85']);
    expect(rows).toContainEqual(['orders:totals.total', 'SAR 52.65']);
    expect(rows).toContainEqual(['receipt:tendered', 'SAR 60.00']);
    expect(rows).toContainEqual(['receipt:change', 'SAR 7.35']);
    expect(doc.blocks).toContainEqual(
      expect.objectContaining({ kind: 'text', text: '  + Medium' }),
    );
    // 12:30 in Riyadh.
    expect(rows.find((r) => r[0] === 'orders:channel.DINE_IN')?.[1]).toMatch(/12:30/);
  });

  it('is right-to-left and localized in Arabic', () => {
    const doc = buildReceipt({ ...context, locale: 'ar' });
    expect(doc.direction).toBe('rtl');
    expect(doc.blocks[0]).toMatchObject({ kind: 'text', text: 'مطبخ تجريبي' });
    expect(doc.blocks).toContainEqual(
      expect.objectContaining({ kind: 'row', start: '2 × برجر كلاسيك' }),
    );
  });

  it('accepts market extensions (e.g. an e-invoice QR code)', () => {
    const doc = buildReceipt({ ...context, locale: 'en' }, [
      () => [{ kind: 'qr', data: 'TLV-BASE64', caption: null }],
    ]);
    expect(doc.blocks).toContainEqual({ kind: 'qr', data: 'TLV-BASE64', caption: null });
  });
});

describe('ESC/POS raster', () => {
  it('packs pixels MSB-first and pads the width to bytes', () => {
    // 10×1: black, white, black, then white…
    const rgba = new Uint8Array(10 * 4).fill(255);
    for (const x of [0, 2, 9]) rgba.set([0, 0, 0, 255], x * 4);
    const bitmap = rgbaToMonoBitmap(rgba, 10, 1);
    expect(bitmap.width).toBe(16);
    expect(Array.from(bitmap.data)).toEqual([0b10100000, 0b01000000]);
  });

  it('ignores transparent pixels', () => {
    const rgba = new Uint8Array([0, 0, 0, 0]);
    expect(Array.from(rgbaToMonoBitmap(rgba, 1, 1).data)).toEqual([0]);
  });

  it('encodes initialize, GS v 0 header, data, feed and cut', () => {
    const job = encodeRasterJob({ width: 16, height: 2, data: new Uint8Array([1, 2, 3, 4]) });
    expect(Array.from(job)).toEqual([
      0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 1, 2, 3, 4, 0x1b, 0x64, 4, 0x1d, 0x56, 0x42,
      0x00,
    ]);
  });

  it('splits tall images into bands', () => {
    const height = 600;
    const job = encodeRasterJob({ width: 8, height, data: new Uint8Array(height) }, { cut: false });
    const headers = [...job.keys()].filter(
      (i) => job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30,
    );
    expect(headers).toHaveLength(3); // 256 + 256 + 88
  });

  it('rejects inconsistent bitmaps', () => {
    expect(() => encodeRasterJob({ width: 10, height: 1, data: new Uint8Array(2) })).toThrow();
    expect(() => encodeRasterJob({ width: 8, height: 2, data: new Uint8Array(1) })).toThrow();
  });
});
