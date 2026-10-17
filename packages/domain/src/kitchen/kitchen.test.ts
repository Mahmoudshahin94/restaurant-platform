import type { KitchenTicketStatus, OrderStatus } from '@pos/shared-types';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { assertTransition } from '../order/state-machine';
import { planTickets, routeItems } from './routing';
import {
  allowedTicketTransitions,
  assertTicketTransition,
  compareTickets,
  deriveOrderStatus,
  ticketUrgency,
} from './tickets';

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

describe('routeItems', () => {
  it('sends each item to every one of its stations and skips items without one', () => {
    const burger = { id: 'burger', stationIds: ['kitchen', 'grill'] };
    const fries = { id: 'fries', stationIds: ['fryer'] };
    const water = { id: 'water', stationIds: [] };
    const cheeseburger = { id: 'cheeseburger', stationIds: ['grill', 'kitchen', 'grill'] };

    const routed = routeItems([burger, fries, water, cheeseburger]);

    expect([...routed.keys()]).toEqual(['kitchen', 'grill', 'fryer']);
    expect(routed.get('kitchen')?.map((i) => i.id)).toEqual(['burger', 'cheeseburger']);
    // A duplicated station id on one item does not duplicate the item.
    expect(routed.get('grill')?.map((i) => i.id)).toEqual(['burger', 'cheeseburger']);
    expect(routed.get('fryer')?.map((i) => i.id)).toEqual(['fries']);
  });

  it('routes nothing when no item needs preparation', () => {
    expect(routeItems([{ id: 'water', stationIds: [] }]).size).toBe(0);
  });
});

describe('planTickets', () => {
  const t = (stationId: string, status: KitchenTicketStatus) => ({
    id: `t-${stationId}`,
    stationId,
    status,
  });

  it('creates, refreshes and cancels tickets to match the edited order', () => {
    const plan = planTickets([t('grill', 'NEW'), t('bar', 'NEW')], ['grill', 'fryer']);
    expect(plan.create).toEqual(['fryer']);
    expect(plan.refresh.map((x) => x.stationId)).toEqual(['grill']);
    expect(plan.cancel.map((x) => x.stationId)).toEqual(['bar']);
  });

  it('reopens a cancelled ticket when its station gets items again', () => {
    const plan = planTickets([t('bar', 'CANCELLED')], ['bar']);
    expect(plan).toEqual({ create: [], refresh: [t('bar', 'CANCELLED')], cancel: [] });
  });

  it('leaves already-cancelled tickets alone', () => {
    expect(planTickets([t('bar', 'CANCELLED')], []).cancel).toEqual([]);
  });

  it('refuses to touch a ticket the kitchen has started', () => {
    for (const status of ['PREPARING', 'READY', 'COMPLETED'] as const) {
      expectError(() => planTickets([t('grill', status)], ['grill']), 'INVALID_ORDER_STATE', {
        reason: 'KITCHEN_STARTED',
      });
      expectError(() => planTickets([t('grill', status)], []), 'INVALID_ORDER_STATE', {
        reason: 'KITCHEN_STARTED',
      });
    }
  });
});

describe('ticket transitions', () => {
  const move = (
    from: KitchenTicketStatus,
    to: KitchenTicketStatus,
    orderStatus: OrderStatus = 'CONFIRMED',
    trigger: 'STAFF' | 'SYSTEM' = 'STAFF',
  ) => {
    assertTicketTransition({ from, to, trigger, orderStatus });
  };

  it('follows NEW → PREPARING → READY → COMPLETED, with undo and recall', () => {
    expect(() => {
      move('NEW', 'PREPARING');
      move('PREPARING', 'READY', 'PREPARING');
      move('READY', 'PREPARING', 'READY');
      move('READY', 'COMPLETED', 'READY');
      move('COMPLETED', 'READY', 'READY');
      move('NEW', 'READY');
    }).not.toThrow();
  });

  it('rejects skipping or reversing steps', () => {
    expectError(
      () => {
        move('NEW', 'COMPLETED');
      },
      'INVALID_TICKET_STATE',
      {
        reason: 'NOT_ALLOWED',
        allowed: ['PREPARING', 'READY'],
      },
    );
    expectError(
      () => {
        move('PREPARING', 'NEW', 'PREPARING');
      },
      'INVALID_TICKET_STATE',
      {
        reason: 'NOT_ALLOWED',
      },
    );
  });

  it('keeps cancellation for the system', () => {
    expectError(
      () => {
        move('NEW', 'CANCELLED');
      },
      'INVALID_TICKET_STATE',
      {
        reason: 'SYSTEM_ONLY',
      },
    );
    expect(() => {
      move('PREPARING', 'CANCELLED', 'CANCELLED', 'SYSTEM');
    }).not.toThrow();
    expect(allowedTicketTransitions('CANCELLED', 'STAFF')).toEqual([]);
  });

  it('lets the system bump ready tickets when the order is handed over', () => {
    expect(() => {
      move('READY', 'COMPLETED', 'COMPLETED', 'SYSTEM');
    }).not.toThrow();
  });

  it('blocks kitchen work on closed orders but still allows bump and recall after handover', () => {
    expectError(
      () => {
        move('NEW', 'PREPARING', 'CANCELLED');
      },
      'INVALID_TICKET_STATE',
      {
        reason: 'ORDER_CLOSED',
      },
    );
    expectError(
      () => {
        move('READY', 'PREPARING', 'COMPLETED');
      },
      'INVALID_TICKET_STATE',
      {
        reason: 'ORDER_CLOSED',
      },
    );
    expect(() => {
      move('READY', 'COMPLETED', 'COMPLETED');
      move('COMPLETED', 'READY', 'COMPLETED');
    }).not.toThrow();
    expectError(
      () => {
        move('COMPLETED', 'READY', 'REFUNDED');
      },
      'INVALID_TICKET_STATE',
      {
        reason: 'ORDER_CLOSED',
      },
    );
  });
});

describe('deriveOrderStatus', () => {
  it('moves the order to PREPARING when the first station starts', () => {
    expect(deriveOrderStatus('CONFIRMED', ['NEW', 'NEW'])).toEqual([]);
    expect(deriveOrderStatus('CONFIRMED', ['PREPARING', 'NEW'])).toEqual(['PREPARING']);
    expect(deriveOrderStatus('CONFIRMED', ['READY', 'NEW'])).toEqual(['PREPARING']);
  });

  it('moves to READY only when every live station is ready', () => {
    expect(deriveOrderStatus('PREPARING', ['READY', 'PREPARING'])).toEqual([]);
    expect(deriveOrderStatus('PREPARING', ['READY', 'COMPLETED', 'CANCELLED'])).toEqual(['READY']);
    // A single quick ticket bumped straight to ready passes through PREPARING.
    expect(deriveOrderStatus('CONFIRMED', ['READY'])).toEqual(['PREPARING', 'READY']);
  });

  it('goes back to PREPARING when a ticket is un-readied', () => {
    expect(deriveOrderStatus('READY', ['READY', 'PREPARING'])).toEqual(['PREPARING']);
    expect(deriveOrderStatus('READY', ['READY', 'COMPLETED'])).toEqual([]);
  });

  it('ignores cancelled tickets and closed orders', () => {
    expect(deriveOrderStatus('CONFIRMED', ['CANCELLED'])).toEqual([]);
    expect(deriveOrderStatus('COMPLETED', ['READY'])).toEqual([]);
    expect(deriveOrderStatus('CANCELLED', ['PREPARING'])).toEqual([]);
  });

  it('only produces transitions the order state machine allows for the system', () => {
    const cases: [OrderStatus, KitchenTicketStatus[]][] = [
      ['CONFIRMED', ['READY']],
      ['CONFIRMED', ['PREPARING']],
      ['PREPARING', ['READY']],
      ['READY', ['PREPARING']],
    ];
    for (const [start, tickets] of cases) {
      let from = start;
      for (const to of deriveOrderStatus(start, tickets)) {
        expect(() =>
          assertTransition({ from, to, trigger: 'SYSTEM', paymentStatus: 'UNPAID' }),
        ).not.toThrow();
        from = to;
      }
    }
  });
});

describe('kitchen screen helpers', () => {
  it('rates ticket age against the location thresholds', () => {
    const thresholds = { warnMinutes: 8, lateMinutes: 15 };
    expect(ticketUrgency(7 * 60_000, thresholds)).toBe('ok');
    expect(ticketUrgency(8 * 60_000, thresholds)).toBe('warn');
    expect(ticketUrgency(15 * 60_000, thresholds)).toBe('late');
  });

  it('shows rush tickets first, then the oldest', () => {
    const tickets = [
      { id: 'b', priority: 'NORMAL' as const, createdAt: '2026-10-17T10:02:00.000Z' },
      { id: 'c', priority: 'RUSH' as const, createdAt: '2026-10-17T10:05:00.000Z' },
      { id: 'a', priority: 'NORMAL' as const, createdAt: '2026-10-17T10:01:00.000Z' },
    ];
    expect([...tickets].sort(compareTickets).map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });
});
