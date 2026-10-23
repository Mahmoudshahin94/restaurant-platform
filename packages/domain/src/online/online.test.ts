import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { assertTransition } from '../order/state-machine';
import { quoteOrder } from '../order/quote';
import { sampleCatalog } from '../menu/fixtures.test-helpers';
import { resolveLocationMenu } from '../menu/resolve-location-menu';
import {
  acceptanceDeadline,
  assertEditableByStaff,
  assertOnlineOrderingOpen,
  assertWebOrderDecision,
  assertWebOrderOptions,
  isAcceptanceExpired,
  isVoidedOnCancel,
  isWithinOpeningHours,
  localWeekMinute,
  onlineOrderingStatus,
  parseOpeningHours,
  webOrderFees,
} from './index';

/** Asserts that `fn` throws a DomainError with this code and (at least) these details. */
function expectError(fn: () => unknown, code: string, details: Record<string, unknown> = {}) {
  let thrown: unknown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DomainError);
  expect((thrown as DomainError).code).toBe(code);
  expect((thrown as DomainError).details).toMatchObject(details);
}

const RIYADH = 'Asia/Riyadh'; // UTC+3, no daylight saving
/** 2026-10-18 is a Sunday. `at('10:00')` is 10:00 in Riyadh that day. */
const at = (time: string, date = '2026-10-18') => new Date(`${date}T${time}:00+03:00`);

describe('opening hours', () => {
  it('reads the weekday and minute in the location timezone', () => {
    expect(localWeekMinute(at('00:30'), RIYADH)).toEqual({ day: 0, minute: 30 });
    // 23:30 UTC on Saturday is already Sunday 02:30 in Riyadh.
    expect(localWeekMinute(new Date('2026-10-17T23:30:00Z'), RIYADH)).toEqual({
      day: 0,
      minute: 150,
    });
  });

  it('is open inside a window and closed outside it', () => {
    const hours = [{ day: 0, open: '09:00', close: '17:00' }];
    expect(isWithinOpeningHours(hours, RIYADH, at('08:59'))).toBe(false);
    expect(isWithinOpeningHours(hours, RIYADH, at('09:00'))).toBe(true);
    expect(isWithinOpeningHours(hours, RIYADH, at('16:59'))).toBe(true);
    expect(isWithinOpeningHours(hours, RIYADH, at('17:00'))).toBe(false);
    // Monday has no window.
    expect(isWithinOpeningHours(hours, RIYADH, at('12:00', '2026-10-19'))).toBe(false);
  });

  it('runs a window past midnight into the next day', () => {
    const hours = [{ day: 0, open: '18:00', close: '02:00' }];
    expect(isWithinOpeningHours(hours, RIYADH, at('23:00'))).toBe(true);
    expect(isWithinOpeningHours(hours, RIYADH, at('01:59', '2026-10-19'))).toBe(true);
    expect(isWithinOpeningHours(hours, RIYADH, at('02:00', '2026-10-19'))).toBe(false);
    // Sunday 01:00 belongs to Saturday's (absent) window.
    expect(isWithinOpeningHours(hours, RIYADH, at('01:00'))).toBe(false);
  });

  it('treats 00:00–00:00 as the whole day and no windows as no restriction', () => {
    expect(
      isWithinOpeningHours([{ day: 0, open: '00:00', close: '00:00' }], RIYADH, at('03:00')),
    ).toBe(true);
    expect(isWithinOpeningHours([], RIYADH, at('03:00'))).toBe(true);
  });

  it('drops malformed stored windows', () => {
    expect(
      parseOpeningHours([
        { day: 1, open: '09:00', close: '17:00' },
        { day: 7, open: '09:00', close: '17:00' },
        { day: 1, open: '9:00', close: '17:00' },
        'nonsense',
      ]),
    ).toEqual([{ day: 1, open: '09:00', close: '17:00' }]);
    expect(parseOpeningHours(null)).toEqual([]);
  });
});

describe('online ordering status', () => {
  const now = at('12:00');
  const base = {
    setting: 'OPEN' as const,
    isActive: true,
    openingHours: [{ day: 0, open: '09:00', close: '22:00' }],
    timeZone: RIYADH,
    hubLastSeenAt: new Date(now.getTime() - 30_000),
    hubStaleAfterMs: 180_000,
    now,
  };

  it('is open when the tenant is open, in hours, with a live hub', () => {
    expect(onlineOrderingStatus(base)).toEqual({ state: 'OPEN', reason: null });
  });

  it('follows the tenant’s choice first, then hours, then the hub', () => {
    expect(onlineOrderingStatus({ ...base, isActive: false }).reason).toBe('LOCATION_INACTIVE');
    expect(onlineOrderingStatus({ ...base, setting: 'CLOSED', hubLastSeenAt: null })).toEqual({
      state: 'CLOSED',
      reason: 'SETTING_CLOSED',
    });
    expect(onlineOrderingStatus({ ...base, setting: 'PAUSED', hubLastSeenAt: null })).toEqual({
      state: 'PAUSED',
      reason: 'SETTING_PAUSED',
    });
    expect(onlineOrderingStatus({ ...base, now: at('23:00'), hubLastSeenAt: null })).toEqual({
      state: 'CLOSED',
      reason: 'OUTSIDE_HOURS',
    });
  });

  it('is OFFLINE when the hub heartbeat is stale or missing', () => {
    expect(onlineOrderingStatus({ ...base, hubLastSeenAt: null }).state).toBe('OFFLINE');
    const stale = new Date(now.getTime() - 180_001);
    expect(onlineOrderingStatus({ ...base, hubLastSeenAt: stale })).toEqual({
      state: 'OFFLINE',
      reason: 'HUB_OFFLINE',
    });
    const fresh = new Date(now.getTime() - 180_000);
    expect(onlineOrderingStatus({ ...base, hubLastSeenAt: fresh }).state).toBe('OPEN');
  });

  it('answers ONLINE_ORDERING_DISABLED or LOCATION_OFFLINE', () => {
    expect(() => {
      assertOnlineOrderingOpen({ state: 'OPEN', reason: null });
    }).not.toThrow();
    expectError(
      () => {
        assertOnlineOrderingOpen({ state: 'OFFLINE', reason: 'HUB_OFFLINE' });
      },
      'LOCATION_OFFLINE',
      {},
    );
    expectError(
      () => {
        assertOnlineOrderingOpen({ state: 'PAUSED', reason: 'SETTING_PAUSED' });
      },
      'ONLINE_ORDERING_DISABLED',
      { state: 'PAUSED', reason: 'SETTING_PAUSED' },
    );
  });
});

describe('website orders', () => {
  const placed = { channel: 'WEBSITE' as const, status: 'PLACED' as const };

  it('adds an untaxed delivery fee only to deliveries', () => {
    expect(webOrderFees('PICKUP', 900)).toEqual([]);
    expect(webOrderFees('DELIVERY', 0)).toEqual([]);
    const fees = webOrderFees('DELIVERY', 900);
    expect(fees).toEqual([{ feeId: 'delivery', amount: 900, taxes: [] }]);

    const menu = resolveLocationMenu(sampleCatalog(), []);
    const quote = quoteOrder({
      menu,
      taxInclusive: false,
      items: [
        {
          lineId: 'l1',
          productId: 'prod-cola',
          variantId: 'var-large',
          modifierIds: [],
          quantity: 1,
        },
      ],
      fees,
    });
    expect(quote.pricing.fees).toBe(900);
    expect(quote.pricing.total).toBe(quote.pricing.subtotal + quote.pricing.tax + 900);
  });

  it('checks fulfillment and payment options', () => {
    const both = { pickupEnabled: true, deliveryEnabled: true };
    expect(() => {
      assertWebOrderOptions(both, 'PICKUP', 'PAY_AT_PICKUP');
    }).not.toThrow();
    expect(() => {
      assertWebOrderOptions(both, 'DELIVERY', 'CASH_ON_DELIVERY');
    }).not.toThrow();
    expect(() => {
      assertWebOrderOptions(both, 'DELIVERY', 'ONLINE_CARD');
    }).not.toThrow();
    expectError(
      () => {
        assertWebOrderOptions(both, 'PICKUP', 'CASH_ON_DELIVERY');
      },
      'VALIDATION_FAILED',
      { reason: 'PAYMENT_OPTION_MISMATCH' },
    );
    expectError(
      () => {
        assertWebOrderOptions({ ...both, deliveryEnabled: false }, 'DELIVERY', 'ONLINE_CARD');
      },
      'ONLINE_ORDERING_DISABLED',
      { reason: 'FULFILLMENT_UNAVAILABLE' },
    );
  });

  it('expires an unaccepted order after its deadline', () => {
    const placedAt = at('12:00');
    const acceptBy = acceptanceDeadline(placedAt, 10);
    expect(acceptBy.toISOString()).toBe(at('12:10').toISOString());
    expect(isAcceptanceExpired({ ...placed, acceptBy }, at('12:10'))).toBe(false);
    expect(isAcceptanceExpired({ ...placed, acceptBy }, at('12:11'))).toBe(true);
    // Accepted orders and staff orders never expire.
    expect(isAcceptanceExpired({ ...placed, status: 'CONFIRMED', acceptBy }, at('13:00'))).toBe(
      false,
    );
    expect(isAcceptanceExpired({ channel: 'PHONE', status: 'PLACED', acceptBy }, at('13:00'))).toBe(
      false,
    );
  });

  it('refuses an acceptance after the deadline but still allows a rejection', () => {
    const order = { ...placed, acceptBy: at('12:10') };
    expect(() => {
      assertWebOrderDecision(order, 'CONFIRMED', at('12:05'));
    }).not.toThrow();
    expectError(
      () => {
        assertWebOrderDecision(order, 'CONFIRMED', at('12:11'));
      },
      'INVALID_ORDER_STATE',
      { reason: 'ACCEPTANCE_EXPIRED' },
    );
    expect(() => {
      assertWebOrderDecision(order, 'CANCELLED', at('12:11'));
    }).not.toThrow();
  });

  it('forbids editing a website order before it is accepted', () => {
    expectError(
      () => {
        assertEditableByStaff(placed);
      },
      'INVALID_ORDER_STATE',
      { reason: 'AWAITING_ACCEPTANCE' },
    );
    expect(() => {
      assertEditableByStaff({ ...placed, status: 'CONFIRMED' });
    }).not.toThrow();
    expect(() => {
      assertEditableByStaff({ channel: 'PHONE', status: 'PLACED' });
    }).not.toThrow();
  });

  it('lets the cloud void online payments of an unaccepted order', () => {
    expect(isVoidedOnCancel(placed, { methodType: 'ONLINE' })).toBe(true);
    expect(isVoidedOnCancel(placed, { methodType: 'CASH' })).toBe(false);
    expect(isVoidedOnCancel({ ...placed, status: 'CONFIRMED' }, { methodType: 'ONLINE' })).toBe(
      false,
    );
  });

  it('cancels an unaccepted order as a system transition, with a reason', () => {
    expect(
      assertTransition({
        from: 'PLACED',
        to: 'CANCELLED',
        trigger: 'SYSTEM',
        paymentStatus: 'PAID',
        reason: 'ACCEPTANCE_TIMEOUT',
      }),
    ).toMatchObject({ trigger: 'SYSTEM', permission: null });
    expectError(
      () =>
        assertTransition({
          from: 'PLACED',
          to: 'CANCELLED',
          trigger: 'SYSTEM',
          paymentStatus: 'UNPAID',
        }),
      'INVALID_ORDER_STATE',
      { reason: 'REASON_REQUIRED' },
    );
    // Staff still cancel with their own rule and permission.
    expect(
      assertTransition({
        from: 'PLACED',
        to: 'CANCELLED',
        trigger: 'STAFF',
        paymentStatus: 'UNPAID',
        reason: 'TOO_BUSY',
      }),
    ).toMatchObject({ trigger: 'STAFF', permission: 'orders.cancel' });
  });
});
