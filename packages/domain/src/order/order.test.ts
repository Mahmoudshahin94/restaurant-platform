import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { sampleCatalog } from '../menu/fixtures.test-helpers';
import { resolveLocationMenu } from '../menu/resolve-location-menu';
import { businessDateFor, formatOrderNumber } from './numbering';
import { quoteOrder } from './quote';
import {
  ORDER_TRANSITIONS,
  allowedTransitions,
  assertTransition,
  canModifyItems,
} from './state-machine';

function expectError(fn: () => unknown, code: string, details: Record<string, unknown>) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    expect((e as DomainError).details).toMatchObject(details);
    return;
  }
  throw new Error('expected error');
}

describe('order state machine', () => {
  const staff = (from: string, to: string, extra: Record<string, unknown> = {}) =>
    assertTransition({
      from,
      to,
      trigger: 'STAFF',
      paymentStatus: 'UNPAID',
      ...extra,
    } as Parameters<typeof assertTransition>[0]);

  it('allows the happy path with the right permissions', () => {
    expect(staff('DRAFT', 'PLACED').permission).toBe('orders.create');
    expect(staff('PLACED', 'CONFIRMED').permission).toBe('orders.update');
    expect(staff('READY', 'COMPLETED', { paymentStatus: 'PAID' }).permission).toBe('orders.update');
  });

  it('rejects transitions that are not in the table', () => {
    expectError(() => staff('PLACED', 'READY'), 'INVALID_ORDER_STATE', {
      reason: 'NOT_ALLOWED',
      allowed: ['CONFIRMED', 'CANCELLED'],
    });
    expectError(() => staff('CANCELLED', 'PLACED'), 'INVALID_ORDER_STATE', {
      reason: 'NOT_ALLOWED',
    });
    expectError(() => staff('COMPLETED', 'CANCELLED'), 'INVALID_ORDER_STATE', {
      reason: 'NOT_ALLOWED',
    });
  });

  it('keeps kitchen-derived statuses system-only', () => {
    expectError(() => staff('CONFIRMED', 'PREPARING'), 'INVALID_ORDER_STATE', {
      reason: 'SYSTEM_ONLY',
    });
    expect(
      assertTransition({
        from: 'PREPARING',
        to: 'READY',
        trigger: 'SYSTEM',
        paymentStatus: 'UNPAID',
      }).trigger,
    ).toBe('SYSTEM');
  });

  it('requires a reason to cancel placed orders, but not drafts', () => {
    expectError(() => staff('PLACED', 'CANCELLED', { reason: '  ' }), 'INVALID_ORDER_STATE', {
      reason: 'REASON_REQUIRED',
    });
    expect(staff('PLACED', 'CANCELLED', { reason: 'Customer left' }).permission).toBe(
      'orders.cancel',
    );
    expect(staff('DRAFT', 'CANCELLED').requiresReason).toBe(false);
  });

  it('requires full payment to complete', () => {
    expectError(
      () => staff('READY', 'COMPLETED', { paymentStatus: 'PARTIALLY_PAID' }),
      'INVALID_ORDER_STATE',
      {
        reason: 'UNPAID',
      },
    );
  });

  it('never leaves terminal states and only allows edits before the kitchen starts', () => {
    expect(
      ORDER_TRANSITIONS.filter((r) => r.from === 'CANCELLED' || r.from === 'REFUNDED'),
    ).toEqual([]);
    expect(allowedTransitions('PREPARING', 'STAFF')).toEqual(['CANCELLED']);
    expect(['DRAFT', 'PLACED', 'CONFIRMED'].every((s) => canModifyItems(s as never))).toBe(true);
    expect(
      ['PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].some((s) => canModifyItems(s as never)),
    ).toBe(false);
  });
});

describe('numbering', () => {
  it('uses the location timezone for the business day', () => {
    const instant = new Date('2026-10-16T22:30:00Z');
    expect(businessDateFor(instant, 'UTC')).toBe('2026-10-16');
    expect(businessDateFor(instant, 'Asia/Riyadh')).toBe('2026-10-17');
    expect(businessDateFor(instant, 'America/New_York')).toBe('2026-10-16');
  });

  it('formats order numbers with a source prefix', () => {
    expect(formatOrderNumber('MAIN', 7)).toBe('MAIN-007');
    expect(formatOrderNumber('W', 1234)).toBe('W-1234');
  });
});

describe('quoteOrder', () => {
  const menu = resolveLocationMenu(sampleCatalog(), []);

  it('validates items against the menu and prices them with product taxes', () => {
    const quote = quoteOrder({
      menu,
      taxInclusive: false,
      items: [
        {
          lineId: 'l1',
          productId: 'prod-burger',
          variantId: null,
          modifierIds: ['mod-medium', 'mod-cheese'],
          quantity: 2,
        },
        {
          lineId: 'l2',
          productId: 'prod-cola',
          variantId: 'var-large',
          modifierIds: [],
          quantity: 1,
        },
      ],
      discounts: [{ id: 'd', type: 'FIXED', value: 0 }],
    });
    expect(quote.lines[0]).toMatchObject({ unitPrice: 2800, quantity: 2, gross: 5600, tax: 840 });
    // Archived "Old levy" is ignored; cola carries VAT + sugar tax.
    expect(quote.lines[0]!.taxes.map((t) => t.taxId)).toEqual(['tax-vat']);
    expect(quote.lines[1]).toMatchObject({ unitPrice: 800, tax: 120 + 400 });
    expect(quote.pricing.total).toBe(5600 + 840 + 800 + 520);
  });

  it('reports which line is invalid', () => {
    expectError(
      () =>
        quoteOrder({
          menu,
          taxInclusive: true,
          items: [
            {
              lineId: 'bad-line',
              productId: 'prod-burger',
              variantId: null,
              modifierIds: [],
              quantity: 1,
            },
          ],
        }),
      'INVALID_MODIFIER_SELECTION',
      { lineId: 'bad-line', reason: 'BELOW_MIN' },
    );
  });
});
