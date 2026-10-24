import { Injectable } from '@nestjs/common';
import { DomainError, assertPermissions, canAccessLocation, selfServicePath } from '@pos/domain';
import type { OrderStatus } from '@pos/shared-types';
import type {
  KioskAttendant,
  KioskContext,
  KioskPaymentOutcome,
  Order,
  PublishedMenu,
  createKioskOrderSchema,
} from '@pos/validation';
import type { z } from 'zod';
import type { AuthenticatedTerminal } from '../../common/auth/device-route';
import type { DeviceActor } from '../../common/auth/principal';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { AuthService } from '../auth/auth.service';
import { PublishedMenuService } from '../menu/published-menu.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { TenantsService } from '../tenants/tenants.service';

type CreateInput = z.output<typeof createKioskOrderSchema>;

/** Cancel reason of an unpaid order the customer abandoned at the kiosk. */
export const KIOSK_CANCEL_REASON = 'KIOSK_CANCELLED';

/** How far an order has come, to make the steps after a payment idempotent. */
const PROGRESS: Partial<Record<OrderStatus, number>> = {
  PLACED: 0,
  CONFIRMED: 1,
  PREPARING: 2,
  READY: 3,
  COMPLETED: 4,
};

const actorOf = (terminal: AuthenticatedTerminal): DeviceActor => ({
  deviceId: terminal.id,
  tenantId: terminal.tenantId,
});

/**
 * Whether an order is this kiosk's own: a KIOSK order it created (its first status change names
 * the device). Another kiosk's or the POS's orders look unknown.
 */
function assertOwn(
  order: { id: string; channel: string; statusHistory: readonly { actorId: string | null }[] },
  terminal: AuthenticatedTerminal,
): void {
  if (order.channel !== 'KIOSK' || order.statusHistory[0]?.actorId !== terminal.id) {
    throw new DomainError('ORDER_NOT_FOUND', 'Order not found', { orderId: order.id });
  }
}

/**
 * The self-service kiosk (ADR 0022): a thin layer over the services the POS uses. The menu is
 * the location's published menu; orders are created by `OrdersService` (channel and source KIOSK,
 * priced by the same domain engine); payments go through `PaymentsService` and the kiosk's card
 * terminal; status changes follow the state machine's SYSTEM rules. Nothing is decided here that
 * the order and payment services do not already enforce.
 */
@Injectable()
export class KioskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly menus: PublishedMenuService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async context(terminal: AuthenticatedTerminal): Promise<KioskContext> {
    const location = await this.prisma.location.findUniqueOrThrow({
      where: { id: terminal.locationId },
    });
    return {
      device: {
        id: terminal.id,
        tenantId: terminal.tenantId,
        locationId: terminal.locationId,
        name: terminal.name,
        type: terminal.type,
      },
      location: {
        id: location.id,
        code: location.code,
        nameEn: location.nameEn,
        nameAr: location.nameAr,
        timezone: location.timezone,
      },
      context: await this.tenants.context(
        terminal.tenantId,
        terminal.locationId,
        'kiosk',
        terminal.id,
      ),
    };
  }

  menu(terminal: AuthenticatedTerminal): Promise<PublishedMenu> {
    return this.menus.getForLocation(terminal.locationId);
  }

  /**
   * Places the customer's order, PLACED and unpaid, either way: paid next at the terminal
   * (`pay`), or waiting for a cashier at the counter.
   */
  async createOrder(
    terminal: AuthenticatedTerminal,
    input: CreateInput,
  ): Promise<{ order: Order; created: boolean }> {
    const result = await this.orders.create(actorOf(terminal), terminal.locationId, {
      id: input.id,
      channel: 'KIOSK',
      status: 'PLACED',
      items: input.items,
      discountIds: [],
      tableId: null,
      customerName: input.customerName,
      customerPhone: null,
      guestCount: null,
      notes: null,
    });
    if (!result.created) assertOwn(result.order, terminal);
    return result;
  }

  /**
   * Pays the order at the kiosk's card terminal. Once paid it moves on by itself: to the kitchen
   * where the location has a kitchen screen, else handed over (`selfServicePath`). A decline
   * leaves the order PLACED (the customer may retry, or pay at the counter). A retry with the same
   * payment id never charges twice, and finishes the steps a lost answer left undone.
   */
  async pay(
    terminal: AuthenticatedTerminal,
    orderId: string,
    input: { id: string },
  ): Promise<KioskPaymentOutcome> {
    const outcome = await this.payments.chargeAtTerminal(
      actorOf(terminal),
      terminal.locationId,
      orderId,
      input,
      (order) => {
        assertOwn(order, terminal);
      },
    );
    if (outcome.payment.status !== 'CAPTURED' || outcome.order.paymentStatus !== 'PAID') {
      return outcome;
    }
    const kitchen = await this.orders.kitchenOn(outcome.order);
    let order = outcome.order;
    for (const to of selfServicePath(kitchen)) {
      if ((PROGRESS[order.status] ?? Number.POSITIVE_INFINITY) >= (PROGRESS[to] ?? 0)) continue;
      order = await this.orders.transitionAsSystem(
        actorOf(terminal),
        terminal.locationId,
        orderId,
        to,
      );
    }
    return { payment: outcome.payment, order };
  }

  /** The customer gave up before paying: the kiosk cancels its own unpaid order. */
  async cancel(terminal: AuthenticatedTerminal, orderId: string): Promise<Order> {
    const order = await this.orders.get(terminal.locationId, orderId);
    assertOwn(order, terminal);
    if (order.paymentStatus !== 'UNPAID') {
      throw new DomainError('INVALID_ORDER_STATE', 'A paid order is cancelled by staff', {
        reason: 'REFUND_FIRST',
      });
    }
    return this.orders.transitionAsSystem(
      actorOf(terminal),
      terminal.locationId,
      orderId,
      'CANCELLED',
      KIOSK_CANCEL_REASON,
    );
  }

  /**
   * A staff member leaving the customer screens: their employee code and PIN (the POS's rule,
   * locked after repeated failures), and `kiosk.attend` at this kiosk's location. No session is
   * issued: the kiosk only opens its attendant menu.
   */
  async attendant(
    terminal: AuthenticatedTerminal,
    employeeCode: string,
    pin: string,
  ): Promise<KioskAttendant> {
    const employee = await this.auth.verifyPin(employeeCode, pin);
    if (employee.tenantId !== terminal.tenantId) {
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid employee code or PIN');
    }
    const principal = await this.access.loadPrincipal(employee.user.id, employee.tenantId);
    if (!canAccessLocation(principal.assignments, terminal.locationId)) {
      throw new DomainError('INSUFFICIENT_PERMISSION', 'Not staff of this location', {
        missing: ['kiosk.attend'],
      });
    }
    assertPermissions(principal.assignments, terminal.locationId, ['kiosk.attend']);
    await this.audit.record({
      action: 'kiosk.attendant_opened',
      entityType: 'Device',
      entityId: terminal.id,
      actorType: 'EMPLOYEE',
      actorId: employee.id,
      tenantId: terminal.tenantId,
      locationId: terminal.locationId,
      metadata: { device: terminal.name },
    });
    return { employeeId: employee.id, displayName: employee.displayName };
  }
}
