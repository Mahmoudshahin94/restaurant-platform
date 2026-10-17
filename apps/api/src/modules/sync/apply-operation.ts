import type { Prisma } from '@pos/database';
import type { PrismaTx } from '@pos/server';
import type { ErrorCode } from '@pos/shared-types';
import type { SyncKitchenTicket, SyncOperation, SyncOrder, SyncShift } from '@pos/validation';
import type { AuthenticatedDevice } from '../devices/device.guard';

/** A pushed operation the cloud will not apply (now or ever, depending on the status). */
export class SyncRefusal extends Error {
  constructor(
    readonly status: 'CONFLICT' | 'REJECTED' | 'RETRY',
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const reject = (message: string) => new SyncRefusal('REJECTED', 'SYNC_REJECTED', message);
const conflict = (message: string) => new SyncRefusal('CONFLICT', 'SYNC_CONFLICT', message);
const outOfScope = (message: string) => new SyncRefusal('REJECTED', 'SYNC_SCOPE_MISMATCH', message);

const date = (value: string) => new Date(value);
const dateOrNull = (value: string | null) => (value === null ? null : new Date(value));

/** What `apply` did; `rowVersion` is the entity's own version column, when it has one. */
export interface Applied {
  rowVersion: number | null;
}

/**
 * Applies one hub operation inside the caller's transaction (ADR 0012): checks scope and
 * ownership, then stores the aggregate's state. Throws `SyncRefusal` to refuse.
 */
export async function applyOperation(
  tx: PrismaTx,
  device: AuthenticatedDevice,
  op: SyncOperation,
): Promise<Applied> {
  if (op.payload.id !== op.entityId) throw reject('entityId does not match the payload id');
  if (
    op.payload.restaurantId !== device.restaurantId ||
    op.payload.locationId !== device.locationId
  ) {
    throw outOfScope('The payload belongs to another restaurant or location than this hub');
  }
  switch (op.operationType) {
    case 'ORDER_UPSERT':
      return applyOrder(tx, device, op.entityVersion, op.payload);
    case 'SHIFT_UPSERT':
      return applyShift(tx, device, op.entityVersion, op.payload);
    case 'KITCHEN_TICKET_UPSERT':
      return applyTicket(tx, device, op.entityVersion, op.payload);
  }
}

type Table = 'orders' | 'shifts' | 'kitchen_tickets';

/**
 * Ownership without timestamps: the hub may write an entity the cloud does not have, or one whose
 * cloud copy is exactly what this location's hub last pushed. Locks the cloud row (if any) so two
 * deliveries for one entity cannot interleave. Returns whether the row exists.
 */
async function claim(
  tx: PrismaTx,
  device: AuthenticatedDevice,
  table: Table,
  entityType: string,
  entityId: string,
  entityVersion: number,
  currentRowVersion: (id: string) => Promise<number | null>,
): Promise<boolean> {
  const locked = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${table}" WHERE id = $1::uuid FOR UPDATE`,
    entityId,
  );
  if (locked.length === 0) return false;

  const last = await tx.processedOperation.findFirst({
    where: { entityType, entityId, locationId: device.locationId, status: 'APPLIED' },
    orderBy: { entityVersion: 'desc' },
    select: { entityVersion: true, rowVersion: true },
  });
  if (!last) {
    throw conflict(`${entityType} exists in the cloud but was never synchronized from this hub`);
  }
  if (entityVersion <= last.entityVersion) {
    // The hub's outbox sequence went backwards (e.g. its database was restored from a backup).
    throw conflict(
      `${entityType} change ${String(entityVersion)} is older than change ${String(last.entityVersion)} already in the cloud`,
    );
  }
  if (last.rowVersion !== null) {
    const rowVersion = await currentRowVersion(entityId);
    if (rowVersion !== last.rowVersion) {
      throw conflict(`${entityType} was changed in the cloud since this hub last synchronized it`);
    }
  }
  return true;
}

// --- Orders --------------------------------------------------------------------------------------

function orderScalars(o: SyncOrder): Prisma.OrderUncheckedCreateInput {
  return {
    id: o.id,
    restaurantId: o.restaurantId,
    locationId: o.locationId,
    orderNumber: o.orderNumber,
    businessDate: date(o.businessDate),
    channel: o.channel,
    status: o.status,
    paymentStatus: o.paymentStatus,
    source: o.source,
    tableId: o.tableId,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    guestCount: o.guestCount,
    notes: o.notes,
    currencyCode: o.currencyCode,
    taxInclusive: o.taxInclusive,
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    taxTotal: o.taxTotal,
    feeTotal: o.feeTotal,
    total: o.total,
    version: o.version,
    createdById: o.createdById,
    placedAt: dateOrNull(o.placedAt),
    completedAt: dateOrNull(o.completedAt),
    cancelledAt: dateOrNull(o.cancelledAt),
    cancelReason: o.cancelReason,
    createdAt: date(o.createdAt),
    updatedAt: date(o.updatedAt),
  };
}

function checkOrderChildren(o: SyncOrder, device: AuthenticatedDevice): void {
  const own = (rows: { orderId: string }[]) => rows.every((r) => r.orderId === o.id);
  if (!own(o.items) || !own(o.taxes) || !own(o.discounts) || !own(o.statusHistory)) {
    throw reject('A child row belongs to another order');
  }
  if (!o.items.every((i) => i.modifiers.every((m) => m.orderItemId === i.id))) {
    throw reject('A modifier belongs to another order line');
  }
  for (const p of o.payments) {
    if (p.orderId !== o.id) throw reject('A payment belongs to another order');
    if (p.restaurantId !== device.restaurantId || p.locationId !== device.locationId) {
      throw outOfScope('A payment belongs to another restaurant or location');
    }
    if (!p.cash.every((c) => c.paymentId === p.id && c.shiftId === p.shiftId)) {
      throw reject('A cash movement does not belong to its payment');
    }
  }
}

async function applyOrder(
  tx: PrismaTx,
  device: AuthenticatedDevice,
  entityVersion: number,
  o: SyncOrder,
): Promise<Applied> {
  checkOrderChildren(o, device);
  const exists = await claim(tx, device, 'orders', 'Order', o.id, entityVersion, async (id) => {
    const row = await tx.order.findUnique({ where: { id }, select: { version: true } });
    return row?.version ?? null;
  });

  const scalars = orderScalars(o);
  if (exists) await tx.order.update({ where: { id: o.id }, data: scalars });
  else await tx.order.create({ data: scalars });

  // Lines, taxes and discounts are replaceable state; their ids are stable across edits.
  const itemIds = o.items.map((i) => i.id);
  await tx.orderItem.deleteMany({ where: { orderId: o.id, id: { notIn: itemIds } } });
  await tx.orderItemModifier.deleteMany({ where: { orderItemId: { in: itemIds } } });
  for (const { modifiers: _modifiers, ...item } of o.items) {
    const data = {
      ...item,
      createdAt: date(item.createdAt),
      updatedAt: date(item.updatedAt),
    } satisfies Prisma.OrderItemUncheckedCreateInput;
    await tx.orderItem.upsert({ where: { id: item.id }, create: data, update: data });
  }
  const modifiers = o.items.flatMap((i) => i.modifiers);
  if (modifiers.length > 0) await tx.orderItemModifier.createMany({ data: modifiers });

  await tx.orderTax.deleteMany({ where: { orderId: o.id } });
  if (o.taxes.length > 0) await tx.orderTax.createMany({ data: o.taxes });
  await tx.orderDiscount.deleteMany({ where: { orderId: o.id } });
  if (o.discounts.length > 0) {
    await tx.orderDiscount.createMany({
      data: o.discounts.map((d) => ({ ...d, createdAt: date(d.createdAt) })),
    });
  }

  // Status history, payments and their cash movements are append-only.
  if (o.statusHistory.length > 0) {
    await tx.orderStatusHistory.createMany({
      data: o.statusHistory.map((h) => ({ ...h, createdAt: date(h.createdAt) })),
      skipDuplicates: true,
    });
  }
  // Charges before the refunds that reference them.
  const payments = [...o.payments].sort(
    (a, b) => Number(a.refundOfId !== null) - Number(b.refundOfId !== null),
  );
  for (const { cash, ...payment } of payments) {
    const existing = await tx.payment.findUnique({ where: { id: payment.id } });
    if (existing) {
      const same =
        existing.orderId === payment.orderId &&
        existing.shiftId === payment.shiftId &&
        existing.type === payment.type &&
        existing.amount === payment.amount &&
        existing.refundOfId === payment.refundOfId;
      if (!same) throw conflict(`Payment ${payment.id} differs from the one already recorded`);
    } else {
      await tx.payment.create({
        data: {
          ...payment,
          createdAt: date(payment.createdAt),
          updatedAt: date(payment.updatedAt),
        },
      });
    }
    if (cash.length > 0) {
      await tx.cashTransaction.createMany({
        data: cash.map((c) => ({ ...c, createdAt: date(c.createdAt) })),
        skipDuplicates: true,
      });
    }
  }
  return { rowVersion: o.version };
}

// --- Shifts --------------------------------------------------------------------------------------

async function applyShift(
  tx: PrismaTx,
  device: AuthenticatedDevice,
  entityVersion: number,
  s: SyncShift,
): Promise<Applied> {
  if (!s.cash.every((c) => c.shiftId === s.id)) {
    throw reject('A cash movement belongs to another shift');
  }
  // Shifts have no version column: ownership rests on the ledger alone.
  const exists = await claim(tx, device, 'shifts', 'Shift', s.id, entityVersion, () =>
    Promise.resolve(null),
  );
  const { cash, ...shift } = s;
  const data = {
    ...shift,
    openedAt: date(shift.openedAt),
    closedAt: dateOrNull(shift.closedAt),
    createdAt: date(shift.createdAt),
    updatedAt: date(shift.updatedAt),
  } satisfies Prisma.ShiftUncheckedCreateInput;
  if (exists) await tx.shift.update({ where: { id: s.id }, data });
  else await tx.shift.create({ data });

  // Movements caused by a payment travel with that payment's order (ADR 0012); the shift brings
  // them only once the payment is in the cloud (e.g. operations queued by a Phase 5 hub).
  const paymentIds = [...new Set(cash.flatMap((c) => (c.paymentId ? [c.paymentId] : [])))];
  const known = new Set(
    paymentIds.length === 0
      ? []
      : (
          await tx.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true } })
        ).map((p) => p.id),
  );
  const storable = cash.filter((c) => c.paymentId === null || known.has(c.paymentId));
  if (storable.length > 0) {
    await tx.cashTransaction.createMany({
      data: storable.map((c) => ({ ...c, createdAt: date(c.createdAt) })),
      skipDuplicates: true,
    });
  }
  return { rowVersion: null };
}

// --- Kitchen tickets -----------------------------------------------------------------------------

async function applyTicket(
  tx: PrismaTx,
  device: AuthenticatedDevice,
  entityVersion: number,
  t: SyncKitchenTicket,
): Promise<Applied> {
  if (!t.items.every((i) => i.ticketId === t.id)) {
    throw reject('A ticket item belongs to another ticket');
  }
  const exists = await claim(
    tx,
    device,
    'kitchen_tickets',
    'KitchenTicket',
    t.id,
    entityVersion,
    async (id) => {
      const row = await tx.kitchenTicket.findUnique({ where: { id }, select: { version: true } });
      return row?.version ?? null;
    },
  );
  const order = await tx.order.findUnique({
    where: { id: t.orderId },
    select: { locationId: true },
  });
  if (!order) {
    throw new SyncRefusal(
      'RETRY',
      'SYNC_DEPENDENCY_MISSING',
      'The ticket’s order is not synced yet',
    );
  }
  if (order.locationId !== device.locationId) {
    throw outOfScope('The ticket’s order belongs to another location');
  }

  const { items, ...ticket } = t;
  const data = {
    ...ticket,
    startedAt: dateOrNull(ticket.startedAt),
    readyAt: dateOrNull(ticket.readyAt),
    completedAt: dateOrNull(ticket.completedAt),
    cancelledAt: dateOrNull(ticket.cancelledAt),
    dismissedAt: dateOrNull(ticket.dismissedAt),
    createdAt: date(ticket.createdAt),
    updatedAt: date(ticket.updatedAt),
  } satisfies Prisma.KitchenTicketUncheckedCreateInput;
  if (exists) await tx.kitchenTicket.update({ where: { id: t.id }, data });
  else await tx.kitchenTicket.create({ data });

  await tx.kitchenTicketItem.deleteMany({ where: { ticketId: t.id } });
  if (items.length > 0) {
    await tx.kitchenTicketItem.createMany({
      data: items.map((i) => ({ ...i, doneAt: dateOrNull(i.doneAt) })),
    });
  }
  return { rowVersion: t.version };
}
