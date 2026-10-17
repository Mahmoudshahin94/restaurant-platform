import { type FormatOptions, formatDateTime, formatMoney, pickLocalized } from '@pos/i18n';
import type { Locale, TextDirection } from '@pos/shared-types';
import type { Order } from '@pos/validation';

/** Device-independent receipt content. Renderers (HTML, canvas → ESC/POS raster) lay it out. */
export type ReceiptBlock =
  | {
      kind: 'text';
      text: string;
      align: 'start' | 'center' | 'end';
      size: 'normal' | 'large';
      bold: boolean;
    }
  | { kind: 'row'; start: string; end: string; bold: boolean; size: 'normal' | 'large' }
  | { kind: 'divider' }
  | { kind: 'spacer' }
  /** Encoded by a renderer as a QR code (e.g. an e-invoicing payload added by an extension). */
  | { kind: 'qr'; data: string; caption: string | null };

export interface ReceiptDocument {
  locale: Locale;
  direction: TextDirection;
  blocks: ReceiptBlock[];
}

export interface ReceiptContext {
  order: Order;
  restaurant: { nameEn: string; nameAr: string };
  location: {
    nameEn: string;
    nameAr: string;
    addressLine: string | null;
    phone: string | null;
    timezone: string;
  };
  cashierName: string | null;
  locale: Locale;
  digits?: FormatOptions['digits'];
  /** When the receipt is printed (ISO UTC). */
  printedAt: string;
  /** Translates `receipt:*` and `orders:*` keys in the receipt's locale. */
  t: (key: string, options?: Record<string, unknown>) => string;
}

/**
 * Adds market-specific content without changing the core receipt, e.g. a Saudi ZATCA QR code or
 * a tax registration number. Extensions return blocks appended before the footer.
 */
export type ReceiptExtension = (context: ReceiptContext) => ReceiptBlock[];

const text = (
  value: string,
  align: 'start' | 'center' | 'end' = 'start',
  size: 'normal' | 'large' = 'normal',
  bold = false,
): ReceiptBlock => ({
  kind: 'text',
  text: value,
  align,
  size,
  bold,
});
const row = (
  start: string,
  end: string,
  bold = false,
  size: 'normal' | 'large' = 'normal',
): ReceiptBlock => ({
  kind: 'row',
  start,
  end,
  bold,
  size,
});

/** Builds the customer receipt for an order: header, lines, totals, payments, footer. */
export function buildReceipt(
  context: ReceiptContext,
  extensions: readonly ReceiptExtension[] = [],
): ReceiptDocument {
  const { order, restaurant, location, locale, t } = context;
  const money = (amount: number) =>
    formatMoney(amount, order.currencyCode, locale, { digits: context.digits ?? 'latn' });
  const name = (entity: { nameEn: string; nameAr: string }) =>
    pickLocalized(entity, 'name', locale);
  const blocks: ReceiptBlock[] = [];

  blocks.push(text(name(restaurant), 'center', 'large', true));
  blocks.push(text(name(location), 'center'));
  if (location.addressLine) blocks.push(text(location.addressLine, 'center'));
  if (location.phone) blocks.push(text(location.phone, 'center'));
  blocks.push({ kind: 'divider' });

  blocks.push(
    text(t('receipt:orderNumber', { number: order.orderNumber }), 'center', 'large', true),
  );
  blocks.push(
    row(
      t(`orders:channel.${order.channel}`),
      formatDateTime(order.createdAt, location.timezone, locale, {
        digits: context.digits ?? 'latn',
      }),
    ),
  );
  if (order.tableLabel) blocks.push(row(t('receipt:table'), order.tableLabel));
  if (order.customerName) blocks.push(row(t('receipt:customer'), order.customerName));
  if (context.cashierName) blocks.push(row(t('receipt:cashier'), context.cashierName));
  blocks.push({ kind: 'divider' });

  for (const item of order.items) {
    const variant = locale === 'ar' ? item.variantNameAr : item.variantNameEn;
    blocks.push(
      row(`${item.quantity} × ${name(item)}${variant ? ` (${variant})` : ''}`, money(item.gross)),
    );
    for (const modifier of item.modifiers) {
      blocks.push(text(`  + ${name(modifier)}`));
    }
    if (item.notes) blocks.push(text(`  ${item.notes}`));
  }
  blocks.push({ kind: 'divider' });

  blocks.push(row(t('orders:totals.subtotal'), money(order.subtotal)));
  for (const discount of order.discounts) blocks.push(row(name(discount), money(-discount.amount)));
  for (const tax of order.taxes) {
    const label = order.taxInclusive ? t('receipt:taxIncluded', { name: name(tax) }) : name(tax);
    blocks.push(row(label, money(tax.amount)));
  }
  if (order.feeTotal > 0) blocks.push(row(t('orders:totals.fees'), money(order.feeTotal)));
  blocks.push(row(t('orders:totals.total'), money(order.total), true, 'large'));

  const charges = order.payments.filter((p) => p.type === 'CHARGE' && p.status === 'CAPTURED');
  const refunds = order.payments.filter((p) => p.type === 'REFUND' && p.status === 'CAPTURED');
  if (charges.length > 0 || refunds.length > 0) {
    blocks.push({ kind: 'divider' });
    for (const p of charges) {
      const method = locale === 'ar' ? p.methodNameAr : p.methodNameEn;
      blocks.push(row(method, money(p.amount)));
      if (p.tendered !== null && p.tendered !== p.amount + p.roundingAdjustment)
        blocks.push(row(t('receipt:tendered'), money(p.tendered)));
      if (p.roundingAdjustment !== 0)
        blocks.push(row(t('receipt:rounding'), money(p.roundingAdjustment)));
      if (p.change > 0) blocks.push(row(t('receipt:change'), money(p.change)));
      if (p.reference) blocks.push(text(t('receipt:reference', { reference: p.reference })));
    }
    for (const r of refunds) blocks.push(row(t('receipt:refund'), money(-r.amount)));
    if (order.balanceDue > 0)
      blocks.push(row(t('receipt:balanceDue'), money(order.balanceDue), true));
  }

  for (const extension of extensions) blocks.push(...extension(context));

  blocks.push({ kind: 'divider' });
  blocks.push(text(t('receipt:thanks'), 'center', 'normal', true));
  blocks.push(
    text(
      formatDateTime(context.printedAt, location.timezone, locale, {
        digits: context.digits ?? 'latn',
      }),
      'center',
    ),
  );
  blocks.push({ kind: 'spacer' });

  return { locale, direction: locale === 'ar' ? 'rtl' : 'ltr', blocks };
}
