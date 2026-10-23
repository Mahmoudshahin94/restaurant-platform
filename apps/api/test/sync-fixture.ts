import { newId } from '@pos/domain';
import type { SyncKitchenTicket, SyncOrder, SyncShift } from '@pos/validation';
import type { TenantFixture } from './helpers';
import type { createMenuFixture } from './menu-fixture';

export interface SyncContext {
  tenant: TenantFixture;
  menu: Awaited<ReturnType<typeof createMenuFixture>>;
  cashMethodId: string;
  registerId: string;
}

/** Payload builders: rows exactly as the hub's outbox stores them. */
export function syncBuilders({ tenant, menu, cashMethodId, registerId }: SyncContext) {
  const now = () => new Date().toISOString();

  function orderRow(overrides: Partial<SyncOrder> = {}): SyncOrder {
    const id = overrides.id ?? newId();
    const itemId = newId();
    const at = now();
    return {
      id,
      tenantId: tenant.tenantId,
      locationId: tenant.locationA,
      orderNumber: `LOCA-${String(Math.floor(Math.random() * 900) + 100)}`,
      businessDate: '2026-10-17T00:00:00.000Z',
      channel: 'DINE_IN',
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      source: 'POS',
      tableId: menu.tables[0]!.id,
      customerName: null,
      customerPhone: null,
      guestCount: 2,
      customerEmail: null,
      fulfillmentType: null,
      deliveryAddress: null,
      notes: null,
      currencyCode: 'SAR',
      taxInclusive: true,
      subtotal: 2800,
      discountTotal: 0,
      taxTotal: 365,
      feeTotal: 0,
      total: 2800,
      version: 1,
      createdById: tenant.cashier.id,
      placedAt: at,
      acceptBy: null,
      completedAt: null,
      cancelledAt: null,
      cancelReason: null,
      createdAt: at,
      updatedAt: at,
      items: [
        {
          id: itemId,
          orderId: id,
          productId: menu.burger.id,
          variantId: null,
          nameEn: 'Burger',
          nameAr: 'برجر',
          variantNameEn: null,
          variantNameAr: null,
          quantity: 1,
          basePrice: 2500,
          unitPrice: 2800,
          gross: 2800,
          discount: 0,
          tax: 365,
          total: 2800,
          notes: null,
          stationIds: [menu.grill.id],
          sortOrder: 0,
          createdAt: at,
          updatedAt: at,
          modifiers: [
            {
              id: newId(),
              orderItemId: itemId,
              modifierId: menu.cheese.id,
              modifierGroupId: menu.cheese.modifierGroupId,
              nameEn: 'Cheese',
              nameAr: 'جبن',
              priceDelta: 300,
            },
          ],
        },
      ],
      taxes: [
        {
          orderId: id,
          taxId: menu.vat.id,
          nameEn: 'VAT',
          nameAr: 'ضريبة',
          rateBps: 1500,
          taxableAmount: 2435,
          amount: 365,
        },
      ],
      discounts: [],
      statusHistory: [
        {
          id: newId(),
          orderId: id,
          fromStatus: null,
          toStatus: 'CONFIRMED',
          actorType: 'USER',
          actorId: tenant.cashier.id,
          source: 'POS',
          reason: null,
          createdAt: at,
        },
      ],
      payments: [],
      ...overrides,
    };
  }

  function shiftRow(overrides: Partial<SyncShift> = {}): SyncShift {
    const id = overrides.id ?? newId();
    const at = now();
    return {
      id,
      tenantId: tenant.tenantId,
      locationId: tenant.locationA,
      cashRegisterId: registerId,
      status: 'OPEN',
      openRegisterId: registerId,
      openingFloat: 10_000,
      openedById: tenant.cashier.id,
      openedAt: at,
      closedById: null,
      closedAt: null,
      expectedCash: null,
      countedCash: null,
      cashDifference: null,
      closingNotes: null,
      createdAt: at,
      updatedAt: at,
      cash: [
        {
          id: newId(),
          shiftId: id,
          type: 'PAY_IN',
          amount: 10_000,
          paymentId: null,
          reason: 'Change for the drawer',
          createdById: tenant.cashier.id,
          createdAt: at,
        },
      ],
      ...overrides,
    };
  }

  /** A cash payment for the whole order, with the drawer movement it caused. */
  function paid(order: SyncOrder, shift: SyncShift): SyncOrder {
    const paymentId = newId();
    const at = now();
    return {
      ...order,
      paymentStatus: 'PAID',
      version: order.version + 1,
      payments: [
        {
          id: paymentId,
          tenantId: order.tenantId,
          locationId: order.locationId,
          orderId: order.id,
          shiftId: shift.id,
          paymentMethodId: cashMethodId,
          methodType: 'CASH',
          methodNameEn: 'Cash',
          methodNameAr: 'نقدًا',
          type: 'CHARGE',
          status: 'CAPTURED',
          provider: 'cash',
          providerRef: null,
          amount: order.total,
          tendered: 5000,
          change: 5000 - order.total,
          roundingAdjustment: 0,
          reference: null,
          refundOfId: null,
          reason: null,
          createdById: tenant.cashier.id,
          createdAt: at,
          updatedAt: at,
          cash: [
            {
              id: newId(),
              shiftId: shift.id,
              type: 'SALE',
              amount: order.total,
              paymentId,
              reason: null,
              createdById: tenant.cashier.id,
              createdAt: at,
            },
          ],
        },
      ],
    };
  }

  function ticketRow(
    order: SyncOrder,
    overrides: Partial<SyncKitchenTicket> = {},
  ): SyncKitchenTicket {
    const id = overrides.id ?? newId();
    const item = order.items[0]!;
    return {
      id,
      tenantId: order.tenantId,
      locationId: order.locationId,
      orderId: order.id,
      stationId: menu.grill.id,
      status: 'NEW',
      priority: 'NORMAL',
      version: 1,
      revision: 1,
      startedAt: null,
      readyAt: null,
      completedAt: null,
      cancelledAt: null,
      dismissedAt: null,
      createdAt: order.createdAt,
      updatedAt: order.createdAt,
      items: [
        {
          id: newId(),
          ticketId: id,
          orderItemId: item.id,
          nameEn: item.nameEn,
          nameAr: item.nameAr,
          variantNameEn: null,
          variantNameAr: null,
          quantity: item.quantity,
          notes: null,
          modifiers: [{ nameEn: 'Cheese', nameAr: 'جبن' }],
          sortOrder: 0,
          doneAt: null,
        },
      ],
      ...overrides,
    };
  }

  return { now, orderRow, shiftRow, paid, ticketRow };
}

export type SyncBuilders = ReturnType<typeof syncBuilders>;

export const op = <P extends { id: string }>(
  entityType: 'Order' | 'Shift' | 'KitchenTicket' | 'AuditLog',
  payload: P,
  entityVersion: number,
  operationId = newId(),
) => ({
  operationId,
  entityType,
  entityId: payload.id,
  operationType: {
    Order: 'ORDER_UPSERT',
    Shift: 'SHIFT_UPSERT',
    KitchenTicket: 'KITCHEN_TICKET_UPSERT',
    AuditLog: 'AUDIT_LOG_APPEND',
  }[entityType],
  entityVersion,
  payload,
});
