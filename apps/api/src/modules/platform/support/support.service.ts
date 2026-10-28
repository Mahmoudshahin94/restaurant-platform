import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import {
  DomainError,
  assertSupportRole,
  assertTransition,
  derivePaymentStatus,
  diffFields,
  isDomainError,
  isUuid,
  paymentTotals,
  totalsFromStoredLines,
} from '@pos/domain';
import {
  AuditService,
  ChangeRecorder,
  OrdersService,
  type PlatformActor,
  PrismaService,
  isHubOwnedOrder,
  isUniqueViolation,
} from '@pos/server';
import {
  OPEN_ORDER_STATUSES,
  type OrderStatus,
  type RestorableEntity,
  SUPPORT_OPERATION_ROLES,
  type SupportFindKind,
  SupportOperationKey,
} from '@pos/shared-types';
import type {
  SupportExecution,
  SupportFindItem,
  SupportFindResult,
  SupportOperationDto,
  SupportPreview,
  SupportRequestParsed,
  supportExecuteSchema,
  supportFindQuerySchema,
} from '@pos/validation';
import type { z } from 'zod';
import { SyncAdminService } from '../../sync/sync-admin.service';
import { PlatformAuditService } from '../platform-audit.service';
import { PlatformTenantsService } from '../tenants/platform-tenants.service';
import { SupportConfirmations } from './support-confirmation';

type Json = Record<string, unknown>;

/** What a preview found: the record, its state now, what the repair would make of it. */
interface Inspection {
  entity: { type: string; id: string; label: string; locationId: string | null };
  before: Json;
  after: Json;
  /** Null when it can be executed. */
  blockedReason: string | null;
}

interface Context {
  tenantId: string;
  actor: PlatformActor;
}

const FIND_LIMIT = 20;

/** The location of an order or ledger row being repaired. */
function locationOf(inspection: Inspection): string {
  const { locationId } = inspection.entity;
  if (!locationId) throw new DomainError('INTERNAL_ERROR', 'The record has no location');
  return locationId;
}
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/**
 * The platform's support tools (ADR 0025). Finding is read-only. A repair is a catalog entry, never
 * free-form editing: it is previewed (the tenant, the record, its state before and after), and
 * executed only with that preview's confirmation, a reason and a role allowed for it. Execution
 * goes through the same domain rules and services as the tenant's own changes (the order state
 * machine as SYSTEM with its money guards, ADR 0014's sync resolution), and writes a platform
 * audit entry and a tenant audit entry, both with before and after. Nothing financial changes
 * silently: a finalized order's totals are only ever reported.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly sync: SyncAdminService,
    private readonly audit: AuditService,
    private readonly platformAudit: PlatformAuditService,
    private readonly tenants: PlatformTenantsService,
    private readonly confirmations: SupportConfirmations,
    private readonly changes: ChangeRecorder,
  ) {}

  operations(): SupportOperationDto[] {
    return Object.values(SupportOperationKey).map((key) => ({
      key,
      roles: [...SUPPORT_OPERATION_ROLES[key]],
    }));
  }

  // --- Finding ----------------------------------------------------------------------------------

  async find(
    tenantId: string,
    query: z.output<typeof supportFindQuerySchema>,
  ): Promise<SupportFindResult> {
    const items = await this.findItems(tenantId, query.kind, query.q);
    return { kind: query.kind, items };
  }

  private async findItems(
    tenantId: string,
    kind: SupportFindKind,
    q: string,
  ): Promise<SupportFindItem[]> {
    const id = isUuid(q) ? q.toLowerCase() : null;
    switch (kind) {
      case 'ORDER': {
        const rows = await this.prisma.order.findMany({
          where: { tenantId, ...(id ? { id } : { orderNumber: contains(q) }) },
          orderBy: { createdAt: 'desc' },
          take: FIND_LIMIT,
          include: {
            items: {
              select: { id: true, productId: true, variantId: true, nameEn: true, quantity: true },
            },
          },
        });
        return rows.map((o) => ({
          kind,
          id: o.id,
          title: o.orderNumber,
          subtitle: o.customerName,
          status: o.status,
          locationId: o.locationId,
          createdAt: o.createdAt.toISOString(),
          data: {
            channel: o.channel,
            paymentStatus: o.paymentStatus,
            total: o.total,
            currencyCode: o.currencyCode,
            businessDate: o.businessDate.toISOString().slice(0, 10),
            version: o.version,
            items: o.items,
          },
        }));
      }
      case 'CUSTOMER': {
        const rows = await this.prisma.order.findMany({
          where: {
            tenantId,
            customerPhone: { not: null },
            OR: [{ customerPhone: { contains: q } }, { customerName: contains(q) }],
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { customerPhone: true, customerName: true, total: true, createdAt: true },
        });
        const customers = new Map<string, SupportFindItem>();
        for (const row of rows) {
          const phone = row.customerPhone?.trim();
          if (!phone) continue;
          const found = customers.get(phone);
          if (found) {
            (found.data as { orders: number }).orders += 1;
            continue;
          }
          customers.set(phone, {
            kind,
            id: createHash('sha256').update(phone).digest('hex'),
            title: row.customerName ?? phone,
            subtitle: phone,
            status: null,
            locationId: null,
            createdAt: row.createdAt.toISOString(),
            data: { orders: 1, lastOrderAt: row.createdAt.toISOString() },
          });
        }
        return [...customers.values()].slice(0, FIND_LIMIT);
      }
      case 'PRODUCT': {
        const rows = await this.prisma.product.findMany({
          where: {
            tenantId,
            OR: id
              ? [{ id }]
              : [
                  { nameEn: contains(q) },
                  { nameAr: { contains: q } },
                  { sku: q },
                  { barcodes: { some: { code: q } } },
                  { variants: { some: { sku: q } } },
                ],
          },
          orderBy: { nameEn: 'asc' },
          take: FIND_LIMIT,
          include: {
            variants: { select: { id: true, nameEn: true, sku: true, archivedAt: true } },
            barcodes: { select: { code: true, variantId: true } },
          },
        });
        return rows.map((p) => ({
          kind,
          id: p.id,
          title: p.nameEn,
          subtitle: p.nameAr,
          status: p.archivedAt ? 'ARCHIVED' : 'ACTIVE',
          locationId: null,
          createdAt: p.createdAt.toISOString(),
          data: {
            sku: p.sku,
            categoryId: p.categoryId,
            archivedAt: iso(p.archivedAt),
            variants: p.variants.map((v) => ({ ...v, archivedAt: iso(v.archivedAt) })),
            barcodes: p.barcodes,
          },
        }));
      }
      case 'PAYMENT': {
        const rows = await this.prisma.payment.findMany({
          where: { tenantId, ...(id ? { OR: [{ id }, { orderId: id }] } : { providerRef: q }) },
          orderBy: { createdAt: 'desc' },
          take: FIND_LIMIT,
          include: { order: { select: { orderNumber: true } } },
        });
        return rows.map((p) => ({
          kind,
          id: p.id,
          title: `${p.order.orderNumber} · ${p.methodNameEn}`,
          subtitle: p.providerRef,
          status: p.status,
          locationId: p.locationId,
          createdAt: p.createdAt.toISOString(),
          data: {
            orderId: p.orderId,
            type: p.type,
            amount: p.amount,
            methodType: p.methodType,
            providerAccountId: p.providerAccountId,
            refundOfId: p.refundOfId,
          },
        }));
      }
      case 'SYNC_OPERATION': {
        const rows = await this.prisma.processedOperation.findMany({
          where: {
            tenantId,
            ...(id
              ? { OR: [{ operationId: id }, { entityId: id }] }
              : { OR: [{ errorCode: q }, { entityType: q }] }),
          },
          orderBy: { updatedAt: 'desc' },
          take: FIND_LIMIT,
        });
        return rows.map((r) => ({
          kind,
          id: r.operationId,
          title: `${r.entityType} ${r.operationType}`,
          subtitle: r.errorCode,
          status: r.resolution ?? r.status,
          locationId: r.locationId,
          createdAt: r.createdAt.toISOString(),
          data: {
            entityType: r.entityType,
            entityId: r.entityId,
            status: r.status,
            errorCode: r.errorCode,
            errorMessage: r.errorMessage,
            attempts: r.attempts,
            resolution: r.resolution,
            resendRequestedAt: iso(r.resendRequestedAt),
          },
        }));
      }
    }
  }

  // --- Repairs ----------------------------------------------------------------------------------

  /** Before and after, and a confirmation when it can be executed. Changes nothing. */
  async preview(ctx: Context, request: SupportRequestParsed): Promise<SupportPreview> {
    assertSupportRole(request.operation, ctx.actor.role);
    const inspection = await this.inspect(ctx.tenantId, request);
    const executable = inspection.blockedReason === null;
    return {
      operation: request.operation,
      tenantId: ctx.tenantId,
      entity: inspection.entity,
      before: inspection.before,
      after: inspection.after,
      changes: diffFields(inspection.before, inspection.after),
      executable,
      blockedReason: inspection.blockedReason,
      confirmation: executable
        ? this.confirmations.issue(this.subject(ctx, request, inspection))
        : null,
    };
  }

  async execute(
    ctx: Context,
    request: z.output<typeof supportExecuteSchema>,
  ): Promise<SupportExecution> {
    assertSupportRole(request.operation, ctx.actor.role);
    await this.tenants.assertWritable(ctx.tenantId);
    const inspection = await this.inspect(ctx.tenantId, request);
    // The record must be exactly as previewed, by this operator, for this repair, within the
    // confirmation's lifetime.
    this.confirmations.verify(request.confirmationToken, this.subject(ctx, request, inspection));
    if (inspection.blockedReason !== null) {
      throw new DomainError('SUPPORT_NOT_EXECUTABLE', 'This repair cannot be applied', {
        reason: inspection.blockedReason,
      });
    }
    const after = await this.apply(ctx, request, request.reason, inspection);
    const changes = diffFields(inspection.before, after);
    const metadata = {
      operation: request.operation,
      params: request.params,
      reason: request.reason,
      before: inspection.before,
      after,
      changes,
    };
    await this.audit.record({
      action: 'support.repair_executed',
      entityType: inspection.entity.type,
      entityId: inspection.entity.id,
      locationId: inspection.entity.locationId,
      metadata,
    });
    await this.platformAudit.record({
      action: `support.${request.operation}`,
      entityType: inspection.entity.type,
      entityId: inspection.entity.id,
      tenantId: ctx.tenantId,
      metadata,
    });
    return {
      operation: request.operation,
      tenantId: ctx.tenantId,
      entity: inspection.entity,
      before: inspection.before,
      after,
      changes,
      reason: request.reason,
      executedAt: new Date().toISOString(),
    };
  }

  private subject(ctx: Context, request: SupportRequestParsed, inspection: Inspection) {
    return {
      operation: request.operation,
      tenantId: ctx.tenantId,
      params: request.params as Json,
      platformUserId: ctx.actor.id,
      before: inspection.before,
    };
  }

  private inspect(tenantId: string, request: SupportRequestParsed): Promise<Inspection> {
    switch (request.operation) {
      case SupportOperationKey.SYNC_RETRY:
      case SupportOperationKey.SYNC_REPROCESS:
        return this.inspectSync(tenantId, request.operation, request.params.operationId);
      case SupportOperationKey.ORDER_STATUS:
        return this.inspectOrderStatus(tenantId, request.params.orderId, request.params.to);
      case SupportOperationKey.ORDER_ITEM_PRODUCT:
        return this.inspectItemProduct(tenantId, request.params);
      case SupportOperationKey.ORDER_TOTALS:
        return this.inspectTotals(tenantId, request.params.orderId);
      case SupportOperationKey.RESTORE_ARCHIVED:
        return this.inspectRestore(tenantId, request.params.entityType, request.params.entityId);
    }
  }

  private async apply(
    ctx: Context,
    request: SupportRequestParsed,
    reason: string,
    inspection: Inspection,
  ): Promise<Json> {
    switch (request.operation) {
      case SupportOperationKey.SYNC_RETRY:
      case SupportOperationKey.SYNC_REPROCESS: {
        const action =
          request.operation === SupportOperationKey.SYNC_RETRY ? 'RESEND' : 'APPLY_HUB';
        await this.sync.resolve(
          { userId: ctx.actor.id },
          locationOf(inspection),
          request.params.operationId,
          { action, note: reason },
        );
        return (await this.inspectSync(ctx.tenantId, request.operation, request.params.operationId))
          .before;
      }
      case SupportOperationKey.ORDER_STATUS: {
        await this.orders.transitionAsSystem(
          { platformUserId: ctx.actor.id, tenantId: ctx.tenantId },
          locationOf(inspection),
          request.params.orderId,
          request.params.to,
          reason,
        );
        return this.orderState(request.params.orderId);
      }
      case SupportOperationKey.ORDER_ITEM_PRODUCT: {
        const { orderItemId, productId, variantId } = request.params;
        await this.prisma.$transaction(async (tx) => {
          // Only the reference changes: the line keeps the name, price and codes it was sold with.
          const updated = await tx.orderItem.updateMany({
            where: {
              id: orderItemId,
              productId: inspection.before.productId as string,
              variantId: inspection.before.variantId as string | null,
              order: { tenantId: ctx.tenantId },
            },
            data: { productId, variantId },
          });
          if (updated.count !== 1) {
            throw new DomainError('SUPPORT_PREVIEW_STALE', 'The line changed', {
              reason: 'CHANGED',
            });
          }
        });
        return (await this.inspectItemProduct(ctx.tenantId, request.params)).before;
      }
      case SupportOperationKey.ORDER_TOTALS: {
        const orderId = request.params.orderId;
        const totals = inspection.after.totals as ReturnType<typeof totalsFromStoredLines>;
        await this.prisma.$transaction(async (tx) => {
          const order = await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            include: { payments: true },
          });
          const settled = order.payments
            .filter((p) => p.status === 'CAPTURED')
            .map((p) => ({ id: p.id, type: p.type, amount: p.amount, refundOfId: p.refundOfId }));
          const claimed = await tx.order.updateMany({
            where: {
              id: orderId,
              tenantId: ctx.tenantId,
              version: inspection.before.version as number,
            },
            data: {
              ...totals,
              paymentStatus: derivePaymentStatus(totals.total, settled),
              version: { increment: 1 },
            },
          });
          if (claimed.count !== 1) {
            throw new DomainError('SUPPORT_PREVIEW_STALE', 'The order changed', {
              reason: 'CHANGED',
            });
          }
          await this.changes.record(tx, { orderIds: [orderId] });
        });
        return this.totalsState(ctx.tenantId, orderId).then((s) => s.before);
      }
      case SupportOperationKey.RESTORE_ARCHIVED: {
        const { entityType, entityId } = request.params;
        try {
          await this.restore(ctx.tenantId, entityType, entityId);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new DomainError('CONFLICT', 'A live record already uses its name or code', {
              reason: 'RESTORE_CLASH',
            });
          }
          throw error;
        }
        return (await this.inspectRestore(ctx.tenantId, entityType, entityId)).before;
      }
    }
  }

  // --- Sync (ADR 0014) --------------------------------------------------------------------------

  private async inspectSync(
    tenantId: string,
    operation: string,
    operationId: string,
  ): Promise<Inspection> {
    const row = await this.prisma.processedOperation.findFirst({
      where: { operationId, tenantId },
    });
    if (!row) throw new DomainError('SYNC_ISSUE_NOT_FOUND', 'Synchronization issue not found');
    const detail = await this.sync.detail(row.locationId, operationId);
    const retry = operation === SupportOperationKey.SYNC_RETRY;
    const option = retry ? detail.options.resend : detail.options.applyHub;
    const before = {
      status: row.status,
      errorCode: row.errorCode,
      resolution: row.resolution,
      resendRequestedAt: iso(row.resendRequestedAt),
      attempts: row.attempts,
    };
    return {
      entity: {
        type: 'SyncOperation',
        id: operationId,
        label: `${row.entityType} ${detail.issue.label ?? row.entityId}`,
        locationId: row.locationId,
      },
      before,
      after: retry
        ? { ...before, resendRequestedAt: 'pending' }
        : { ...before, status: 'APPLIED', resolution: 'APPLIED_HUB' },
      blockedReason: option.allowed ? null : (option.reason ?? 'NOT_ALLOWED'),
    };
  }

  // --- Orders -----------------------------------------------------------------------------------

  private async loadOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        payments: true,
        items: { select: { unitPrice: true, quantity: true } },
        taxes: { select: { amount: true } },
        discounts: { select: { amount: true } },
      },
    });
    if (!order) throw new DomainError('ORDER_NOT_FOUND', 'Order not found');
    return order;
  }

  private async orderState(orderId: string): Promise<Json> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    return { status: order.status, paymentStatus: order.paymentStatus, version: order.version };
  }

  /**
   * A status correction follows the SYSTEM rules of the state machine. On top of the rules' own
   * guard (paid before handing over), money must not be stranded: a cancellation needs nothing
   * held, a refund needs everything refunded. An order the location's hub owns is corrected at
   * the location (ADR 0014).
   */
  private async inspectOrderStatus(
    tenantId: string,
    orderId: string,
    to: OrderStatus,
  ): Promise<Inspection> {
    const order = await this.loadOrder(tenantId, orderId);
    const settled = order.payments
      .filter((p) => p.status === 'CAPTURED')
      .map((p) => ({ id: p.id, type: p.type, amount: p.amount, refundOfId: p.refundOfId }));
    const { paid, refunded } = paymentTotals(order.total, settled);
    const before = {
      status: order.status,
      paymentStatus: order.paymentStatus,
      version: order.version,
    };
    let blockedReason: string | null = null;
    try {
      assertTransition({
        from: order.status,
        to,
        trigger: 'SYSTEM',
        paymentStatus: order.paymentStatus,
        reason: 'support',
      });
    } catch (error) {
      if (!isDomainError(error)) throw error;
      const reason = error.details.reason;
      blockedReason = typeof reason === 'string' ? reason : 'NOT_ALLOWED';
    }
    if (blockedReason === null) {
      if (to === 'CANCELLED' && paid - refunded > 0) blockedReason = 'REFUND_FIRST';
      else if (to === 'REFUNDED' && order.paymentStatus !== 'REFUNDED')
        blockedReason = 'NOT_REFUNDED';
      else if (await isHubOwnedOrder('cloud', this.prisma, orderId))
        blockedReason = 'OWNED_BY_LOCATION';
    }
    return {
      entity: {
        type: 'Order',
        id: order.id,
        label: order.orderNumber,
        locationId: order.locationId,
      },
      before,
      after: { ...before, status: to, version: order.version + 1 },
      blockedReason,
    };
  }

  private async inspectItemProduct(
    tenantId: string,
    params: { orderItemId: string; productId: string; variantId: string | null },
  ): Promise<Inspection> {
    // Order lines carry no tenant of their own: they are reached through the tenant's order.
    const item = await this.prisma.orderItem.findFirst({
      where: { id: params.orderItemId, order: { tenantId } },
      include: {
        order: { select: { id: true, orderNumber: true, locationId: true, status: true } },
      },
    });
    if (!item) throw new DomainError('NOT_FOUND', 'Order line not found');
    const product = await this.prisma.product.findFirst({
      where: { id: params.productId, tenantId },
      select: { id: true, nameEn: true },
    });
    if (!product) throw new DomainError('PRODUCT_NOT_FOUND', 'Product not found');
    if (params.variantId !== null) {
      const variant = await this.prisma.productVariant.count({
        where: { id: params.variantId, productId: product.id },
      });
      if (variant !== 1) throw new DomainError('VARIANT_NOT_FOUND', 'Variant not found');
    }
    const snapshot = {
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      variantNameEn: item.variantNameEn,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      total: item.total,
      sku: item.sku,
    };
    const before = { productId: item.productId, variantId: item.variantId, snapshot };
    const unchanged = item.productId === params.productId && item.variantId === params.variantId;
    const open = OPEN_ORDER_STATUSES.includes(item.order.status);
    const hubOpen = open && (await isHubOwnedOrder('cloud', this.prisma, item.order.id));
    return {
      entity: {
        type: 'OrderItem',
        id: item.id,
        label: `${item.order.orderNumber} · ${item.nameEn}`,
        locationId: item.order.locationId,
      },
      before,
      after: { productId: params.productId, variantId: params.variantId, snapshot },
      blockedReason: unchanged ? 'UNCHANGED' : hubOpen ? 'OWNED_BY_LOCATION' : null,
    };
  }

  private async totalsState(tenantId: string, orderId: string) {
    const order = await this.loadOrder(tenantId, orderId);
    const stored = {
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      taxTotal: order.taxTotal,
      feeTotal: order.feeTotal,
      total: order.total,
    };
    const computed = totalsFromStoredLines({
      taxInclusive: order.taxInclusive,
      lines: order.items,
      discounts: order.discounts.map((d) => d.amount),
      taxes: order.taxes.map((t) => t.amount),
      feeTotal: order.feeTotal,
    });
    return {
      order,
      before: { totals: stored, status: order.status, version: order.version } as Json,
      computed,
    };
  }

  /**
   * Open orders get their header recomputed from their own lines. A finalized order's money was
   * taken on its totals: it is never changed, the preview only reports the difference.
   */
  private async inspectTotals(tenantId: string, orderId: string): Promise<Inspection> {
    const { order, before, computed } = await this.totalsState(tenantId, orderId);
    const unchanged = diffFields(before.totals as Json, { ...computed }).length === 0;
    const open = OPEN_ORDER_STATUSES.includes(order.status);
    const blockedReason = unchanged
      ? 'UNCHANGED'
      : !open
        ? 'FINALIZED'
        : (await isHubOwnedOrder('cloud', this.prisma, orderId))
          ? 'OWNED_BY_LOCATION'
          : null;
    return {
      entity: {
        type: 'Order',
        id: order.id,
        label: order.orderNumber,
        locationId: order.locationId,
      },
      before,
      after: { ...before, totals: computed, version: order.version + (blockedReason ? 0 : 1) },
      blockedReason,
    };
  }

  // --- Archived records -------------------------------------------------------------------------

  private async archived(
    tenantId: string,
    type: RestorableEntity,
    id: string,
  ): Promise<{
    id: string;
    nameEn: string;
    archivedAt: Date | null;
    locationId: string | null;
  } | null> {
    const select = { id: true, nameEn: true, archivedAt: true } as const;
    const where = { id, tenantId };
    switch (type) {
      case 'CATEGORY':
        return this.withoutLocation(this.prisma.category.findFirst({ where, select }));
      case 'PRODUCT':
        return this.withoutLocation(this.prisma.product.findFirst({ where, select }));
      case 'MODIFIER_GROUP':
        return this.withoutLocation(this.prisma.modifierGroup.findFirst({ where, select }));
      case 'KITCHEN_STATION':
        return this.withoutLocation(this.prisma.kitchenStation.findFirst({ where, select }));
      case 'TAX':
        return this.withoutLocation(this.prisma.tax.findFirst({ where, select }));
      case 'DISCOUNT':
        return this.withoutLocation(this.prisma.discount.findFirst({ where, select }));
      case 'PAYMENT_METHOD':
        return this.withoutLocation(this.prisma.paymentMethod.findFirst({ where, select }));
      case 'CASH_REGISTER':
        // A cash drawer belongs to a location, and through it to the tenant.
        return this.prisma.cashRegister.findFirst({
          where: { id, location: { tenantId } },
          select: { ...select, locationId: true },
        });
    }
  }

  private async withoutLocation(
    row: Promise<{ id: string; nameEn: string; archivedAt: Date | null } | null>,
  ) {
    const found = await row;
    return found ? { ...found, locationId: null } : null;
  }

  private async inspectRestore(
    tenantId: string,
    type: RestorableEntity,
    id: string,
  ): Promise<Inspection> {
    const row = await this.archived(tenantId, type, id);
    if (!row) throw new DomainError('NOT_FOUND', 'Record not found');
    const before = { archivedAt: iso(row.archivedAt) };
    return {
      entity: { type, id: row.id, label: row.nameEn, locationId: row.locationId },
      before,
      after: { archivedAt: null },
      blockedReason: row.archivedAt ? null : 'NOT_ARCHIVED',
    };
  }

  /** Brings a record back; configuration triggers carry it to the location hubs (ADR 0012). */
  private async restore(tenantId: string, type: RestorableEntity, id: string): Promise<void> {
    const where = { id, tenantId, archivedAt: { not: null } };
    const data = { archivedAt: null };
    const done = await (async (): Promise<Prisma.BatchPayload> => {
      switch (type) {
        case 'CATEGORY':
          return this.prisma.category.updateMany({ where, data });
        case 'PRODUCT':
          return this.prisma.product.updateMany({ where, data });
        case 'MODIFIER_GROUP':
          return this.prisma.modifierGroup.updateMany({ where, data });
        case 'KITCHEN_STATION':
          return this.prisma.kitchenStation.updateMany({ where, data });
        case 'TAX':
          return this.prisma.tax.updateMany({ where, data });
        case 'DISCOUNT':
          return this.prisma.discount.updateMany({ where, data });
        case 'PAYMENT_METHOD':
          return this.prisma.paymentMethod.updateMany({ where, data });
        case 'CASH_REGISTER':
          return this.prisma.cashRegister.updateMany({
            where: { id, location: { tenantId }, archivedAt: { not: null } },
            data,
          });
      }
    })();
    if (done.count !== 1) {
      throw new DomainError('SUPPORT_PREVIEW_STALE', 'The record changed', { reason: 'CHANGED' });
    }
  }
}
