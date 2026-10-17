import { describe, expect, it } from 'vitest';
import { type OutboxEntry, backoffDelay, dependenciesOf, entityKey, planBatch } from './plan-batch';

const now = new Date('2026-10-17T12:00:00Z');
let seq = 0;
const entry = (
  entityType: string,
  entityId: string,
  overrides: Partial<OutboxEntry> = {},
): OutboxEntry => ({
  id: `op-${String((seq += 1)).padStart(3, '0')}`,
  entityType,
  entityId,
  status: 'PENDING',
  nextRetryAt: null,
  ...overrides,
});

describe('planBatch', () => {
  it('sends only the newest operation of an entity, covering the older ones', () => {
    const a1 = entry('Order', 'a');
    const b1 = entry('Order', 'b');
    const a2 = entry('Order', 'a');
    const a3 = entry('Order', 'a');
    expect(planBatch([a1, b1, a2, a3], new Map(), now, 10)).toEqual([
      { key: 'Order:a', sendId: a3.id, coveredIds: [a1.id, a2.id, a3.id] },
      { key: 'Order:b', sendId: b1.id, coveredIds: [b1.id] },
    ]);
  });

  it('holds back an entity with a failed or waiting operation, and only that entity', () => {
    const failed = entry('Order', 'a', { status: 'FAILED' });
    const behind = entry('Order', 'a');
    const waiting = entry('Order', 'b', { nextRetryAt: new Date(now.getTime() + 60_000) });
    const due = entry('Order', 'c', { nextRetryAt: new Date(now.getTime() - 1) });
    const other = entry('Shift', 's');
    expect(
      planBatch([failed, behind, waiting, due, other], new Map(), now, 10).map((p) => p.key),
    ).toEqual(['Order:c', 'Shift:s']);
  });

  it('sends dependencies first, even when they appear later in the outbox', () => {
    const order = entry('Order', 'o');
    const shift = entry('Shift', 's');
    const ticket = entry('KitchenTicket', 't');
    const deps = new Map([
      [order.id, [entityKey('Shift', 's')]],
      [ticket.id, [entityKey('Order', 'o')]],
    ]);
    // Ticket listed before its order to prove the passes reorder correctly.
    expect(planBatch([ticket, order, shift], deps, now, 10).map((p) => p.key)).toEqual([
      'Shift:s',
      'Order:o',
      'KitchenTicket:t',
    ]);
  });

  it('does not send an entity whose dependency cannot go', () => {
    const shift = entry('Shift', 's', { status: 'FAILED' });
    const order = entry('Order', 'o');
    const independent = entry('Order', 'x');
    const deps = new Map([[order.id, [entityKey('Shift', 's')]]]);
    expect(planBatch([shift, order, independent], deps, now, 10).map((p) => p.key)).toEqual([
      'Order:x',
    ]);
  });

  it('ignores dependencies that are already synchronized, and respects the batch size', () => {
    const orders = Array.from({ length: 5 }, (_, i) => entry('Order', `o${String(i)}`));
    const deps = new Map(orders.map((o) => [o.id, [entityKey('Shift', 'synced-long-ago')]]));
    expect(planBatch(orders, deps, now, 3)).toHaveLength(3);
  });
});

describe('dependenciesOf', () => {
  it('links tickets to their order and orders to the shifts of their payments', () => {
    expect(dependenciesOf('KitchenTicket', { orderId: 'o' })).toEqual(['Order:o']);
    expect(
      dependenciesOf('Order', {
        payments: [{ shiftId: 's1' }, { shiftId: 's1' }, { shiftId: 's2' }],
      }),
    ).toEqual(['Shift:s1', 'Shift:s2']);
    expect(dependenciesOf('Shift', { cash: [] })).toEqual([]);
    expect(dependenciesOf('Order', null)).toEqual([]);
  });
});

describe('backoffDelay (full jitter)', () => {
  it('stays between zero and the capped exponential ceiling', () => {
    expect(backoffDelay(0, 2000, 60_000, () => 0.999)).toBe(1998);
    expect(backoffDelay(3, 2000, 60_000, () => 0.5)).toBe(8000);
    expect(backoffDelay(30, 2000, 60_000, () => 0.999)).toBe(59_940);
    expect(backoffDelay(5, 2000, 60_000, () => 0)).toBe(0);
  });
});
