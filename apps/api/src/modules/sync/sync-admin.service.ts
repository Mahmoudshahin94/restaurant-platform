import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import {
  DomainError,
  type SyncIssueFacts,
  assertSyncResolution,
  derivePaymentStatus,
  syncResolutionOptions,
} from '@pos/domain';
import {
  AuditService,
  OnlinePaymentsService,
  type Principal,
  PrismaService,
  type PrismaTx,
  isUniqueViolation,
} from '@pos/server';
import { WebRejectReason } from '@pos/shared-types';
import {
  type AdminSyncIssue,
  type LocationSyncStatus,
  type ResolveSyncIssueRequest,
  type SyncEntityVersion,
  type SyncIssueDetail,
  type SyncResolution,
  type syncIssuesQuerySchema,
  syncOperationSchema,
  syncOrderSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { DevicesService, toAdminDevice } from '../devices/devices.service';
import { type ApplyHooks, SyncRefusal, applyOperation } from './apply-operation';
import { orderAggregate } from './cloud-orders.service';
import { recordOrderChange, recordResolutionChange } from './web-order-change.recorder';

type LedgerRow = Prisma.ProcessedOperationGetPayload<object>;
type Json = Record<string, unknown>;

/** Refused and not settled yet. */
const OPEN: Prisma.ProcessedOperationWhereInput = {
  status: { in: ['CONFLICT', 'REJECTED'] },
  resolution: null,
};

const asRecord = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(asRecord) : []);
/** Dates become ISO strings, as in the hub's outbox. */
const plain = (value: unknown): Json => asRecord(JSON.parse(JSON.stringify(value)));

/** Captured charges minus captured refunds of an aggregate's payments. */
function paidOf(payments: Json[]): number {
  return payments
    .filter((p) => p.status === 'CAPTURED')
    .reduce((sum, p) => sum + (p.type === 'REFUND' ? -1 : 1) * (int(p.amount) ?? 0), 0);
}

/** One side of a conflict, summarised the same way for the hub's and the cloud's copy. */
function summarise(entityType: string, data: Json): SyncEntityVersion {
  const payments = list(data.payments);
  const isOrder = entityType === 'Order';
  return {
    label: str(data.orderNumber),
    status: str(data.status),
    paymentStatus: str(data.paymentStatus),
    total: int(data.total),
    itemCount: Array.isArray(data.items) ? data.items.length : null,
    paymentCount: isOrder ? payments.length : null,
    paidTotal: isOrder ? paidOf(payments) : null,
    version: int(data.version),
    updatedAt: str(data.updatedAt),
    data,
  };
}

/**
 * The administrator's side of synchronization (ADR 0014): each location's hub link, the operations
 * the cloud refused from it, and their resolution. Nothing is decided silently: a refused change
 * waits for a person, who sees both versions and chooses; every decision is audited, the version
 * that loses is kept (ledger payload or audit log), and the hub learns the decision through the
 * `RESOLUTION` topic of the change feed.
 */
@Injectable()
export class SyncAdminService {
  private readonly hooks: ApplyHooks;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly devices: DevicesService,
    private readonly payments: OnlinePaymentsService,
  ) {
    this.hooks = {
      voidOnlinePayments: (tx, orderId, reason) => payments.voidAll(tx, orderId, reason),
      recordOrderChange,
    };
  }

  async status(locationId: string): Promise<LocationSyncStatus> {
    const [rows, openIssues, last] = await Promise.all([
      this.prisma.device.findMany({
        where: { locationId, type: 'GATEWAY' },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.processedOperation.count({ where: { locationId, ...OPEN } }),
      this.prisma.processedOperation.aggregate({
        where: { locationId },
        _max: { updatedAt: true },
      }),
    ]);
    const now = new Date();
    return {
      locationId,
      hubs: rows.map((row) => toAdminDevice(row, this.devices.staleAfterMs, now)),
      openIssues,
      lastReceivedAt: last._max.updatedAt?.toISOString() ?? null,
    };
  }

  async issues(
    locationId: string,
    query: z.output<typeof syncIssuesQuerySchema>,
  ): Promise<AdminSyncIssue[]> {
    const where: Prisma.ProcessedOperationWhereInput =
      query.state === 'open'
        ? { locationId, ...OPEN }
        : query.state === 'resolved'
          ? { locationId, resolution: { not: null } }
          : {
              locationId,
              OR: [{ status: { in: ['CONFLICT', 'REJECTED'] } }, { resolution: { not: null } }],
            };
    const rows = await this.prisma.processedOperation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return this.toIssues(rows);
  }

  async detail(locationId: string, operationId: string): Promise<SyncIssueDetail> {
    const row = await this.load(this.prisma, locationId, operationId);
    return this.describe(this.prisma, row);
  }

  async resolve(
    principal: Principal,
    locationId: string,
    operationId: string,
    input: ResolveSyncIssueRequest,
  ): Promise<SyncIssueDetail> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // Locks the ledger row: a racing push or a second administrator waits, then sees the
          // decision.
          await tx.$queryRaw`
            SELECT operation_id FROM processed_operations
            WHERE operation_id = ${operationId}::uuid FOR UPDATE`;
          const row = await this.load(tx, locationId, operationId);
          const cloud = await this.cloudCopy(tx, row);
          assertSyncResolution(await this.facts(tx, row, cloud), input.action);
          const hubVersion = row.payload ? summarise(row.entityType, asRecord(row.payload)) : null;
          const decided = { resolvedAt: new Date(), resolvedById: principal.userId };
          const audit = {
            action: 'sync.issue_resolved',
            entityType: row.entityType,
            entityId: row.entityId,
            locationId,
            metadata: {
              operationId,
              decision: input.action,
              note: input.note,
              refusal: { code: row.errorCode, message: row.errorMessage },
              hubVersion: hubVersion && { ...hubVersion, data: undefined },
            } as Record<string, unknown>,
          };

          if (input.action === 'APPLY_HUB') {
            const rowVersion = await this.applyHub(tx, row);
            await tx.processedOperation.update({
              where: { operationId },
              data: {
                status: 'APPLIED',
                rowVersion,
                resolution: 'APPLIED_HUB',
                resolutionNote: input.note,
                ...decided,
              },
            });
            // What the cloud had before is kept, in full, in the audit trail.
            audit.metadata.cloudBefore = cloud;
          } else if (input.action === 'KEEP_CLOUD') {
            await tx.processedOperation.update({
              where: { operationId },
              data: {
                resolution: 'KEPT_CLOUD',
                // The baseline for the hub's next change (it must build on this version).
                rowVersion: int(cloud?.version),
                resolutionNote: input.note,
                ...decided,
              },
            });
          } else {
            await tx.processedOperation.update({
              where: { operationId },
              data: { resendRequestedAt: decided.resolvedAt },
            });
            audit.action = 'sync.resend_requested';
          }
          await this.audit.record(audit, tx);
          await recordResolutionChange(tx, row);
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (error instanceof SyncRefusal) {
        throw new DomainError('CONFLICT', error.message, {
          reason: 'APPLY_FAILED',
          code: error.code,
        });
      }
      if (isUniqueViolation(error)) {
        throw new DomainError('CONFLICT', 'The restaurant’s version clashes with another record', {
          reason: 'APPLY_FAILED',
          code: 'SYNC_CONFLICT',
        });
      }
      throw error;
    }
    return this.detail(locationId, operationId);
  }

  /** The decision for the hub (device credential), after a `RESOLUTION` change. */
  async resolutionFor(
    device: { id: string; locationId: string },
    operationId: string,
  ): Promise<SyncResolution> {
    const row = await this.prisma.processedOperation.findUnique({ where: { operationId } });
    const decided = row && (row.resolution !== null || row.resendRequestedAt !== null) ? row : null;
    if (decided?.locationId !== device.locationId) {
      throw new DomainError('SYNC_ISSUE_NOT_FOUND', 'No decision for this operation');
    }
    if (decided.resolution === 'KEPT_CLOUD' && decided.entityType === 'Order') {
      const order = await this.prisma.order.findUnique({
        where: { id: decided.entityId },
        include: orderAggregate,
      });
      return {
        operationId,
        entityType: decided.entityType,
        entityId: decided.entityId,
        action: 'ADOPT_CLOUD',
        order: order ? syncOrderSchema.parse(plain(order)) : null,
      };
    }
    return {
      operationId,
      entityType: decided.entityType,
      entityId: decided.entityId,
      action: 'RESEND',
      order: null,
    };
  }

  // --- internals ---------------------------------------------------------------------------------

  private async load(tx: PrismaTx, locationId: string, operationId: string): Promise<LedgerRow> {
    const row = await tx.processedOperation.findUnique({ where: { operationId } });
    // Ordinary applied operations are not issues; only refusals (and what became of them) are.
    const isIssue =
      row !== null &&
      (row.status !== 'APPLIED' || row.resolution !== null) &&
      row.locationId === locationId;
    if (!isIssue) {
      throw new DomainError('SYNC_ISSUE_NOT_FOUND', 'Synchronization issue not found', {
        operationId,
      });
    }
    return row;
  }

  /** The cloud's current copy of the entity (plain JSON), or null when the cloud has none. */
  private async cloudCopy(tx: PrismaTx, row: LedgerRow): Promise<Json | null> {
    switch (row.entityType) {
      case 'Order': {
        const order = await tx.order.findUnique({
          where: { id: row.entityId },
          include: orderAggregate,
        });
        return order ? plain(order) : null;
      }
      case 'Shift': {
        const shift = await tx.shift.findUnique({
          where: { id: row.entityId },
          include: { cash: true },
        });
        return shift ? plain(shift) : null;
      }
      case 'KitchenTicket': {
        const ticket = await tx.kitchenTicket.findUnique({
          where: { id: row.entityId },
          include: { items: true },
        });
        return ticket ? plain(ticket) : null;
      }
      default:
        return null;
    }
  }

  private async facts(tx: PrismaTx, row: LedgerRow, cloud: Json | null): Promise<SyncIssueFacts> {
    const device = await tx.device.findUnique({
      where: { id: row.deviceId },
      select: { status: true },
    });
    const hubPayments = list(asRecord(row.payload).payments).map((p) => str(p.id));
    const cloudPayments = new Set(list(cloud?.payments).map((p) => str(p.id)));
    return {
      status: row.status,
      errorCode: row.errorCode,
      entityType: row.entityType,
      resolved: row.resolution !== null,
      hasHubVersion: row.payload !== null,
      cloudHasEntity: cloud !== null,
      hubOnlyPaymentIds: hubPayments.filter(
        (id): id is string => id !== null && !cloudPayments.has(id),
      ),
      hubActive: device?.status === 'ACTIVE',
    };
  }

  private async describe(tx: PrismaTx, row: LedgerRow): Promise<SyncIssueDetail> {
    const cloud = await this.cloudCopy(tx, row);
    const options = syncResolutionOptions(await this.facts(tx, row, cloud));
    const [issue] = await this.toIssues([row]);
    if (!issue) throw new Error('unreachable');
    return {
      issue,
      hubVersion: row.payload ? summarise(row.entityType, asRecord(row.payload)) : null,
      cloudVersion: cloud ? summarise(row.entityType, cloud) : null,
      options: {
        applyHub: options.APPLY_HUB,
        keepCloud: options.KEEP_CLOUD,
        resend: options.RESEND,
      },
    };
  }

  /**
   * Stores the hub's refused state as if it had been accepted, without the ownership check.
   * Everything else still applies (scope, schema, append-only payments). Returns the row version.
   */
  private async applyHub(tx: PrismaTx, row: LedgerRow): Promise<number | null> {
    const parsed = syncOperationSchema.safeParse({
      operationId: row.operationId,
      entityType: row.entityType,
      entityId: row.entityId,
      operationType: row.operationType,
      entityVersion: row.entityVersion,
      payload: row.payload,
    });
    if (!parsed.success) {
      throw new DomainError('CONFLICT', 'The restaurant’s version is not valid', {
        reason: 'INVALID_HUB_VERSION',
      });
    }
    const device = { id: row.deviceId, restaurantId: row.restaurantId, locationId: row.locationId };
    const applied = await applyOperation(tx, device, parsed.data, this.hooks, { force: true });
    if (parsed.data.operationType === 'ORDER_UPSERT') {
      await this.settleOrderMoney(tx, parsed.data.payload.id);
    }
    return applied.rowVersion;
  }

  /**
   * After the hub's order replaced the cloud's: payments are append-only, so the cloud may hold
   * more than the hub's copy listed (an online void). The payment status follows every recorded
   * payment, a website order the restaurant rejected has its online payment voided, and the hub
   * is told to merge what it lacks. Neither bumps the order's version.
   */
  private async settleOrderMoney(tx: PrismaTx, orderId: string): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payments: true },
    });
    let changed = false;
    if (order.channel === 'WEBSITE' && order.status === 'CANCELLED') {
      changed =
        (await this.payments.voidAll(tx, orderId, order.cancelReason ?? WebRejectReason.OTHER)) > 0;
    }
    const payments = await tx.payment.findMany({ where: { orderId, status: 'CAPTURED' } });
    const status = derivePaymentStatus(
      order.total,
      payments.map((p) => ({ id: p.id, type: p.type, amount: p.amount, refundOfId: p.refundOfId })),
    );
    if (status !== order.paymentStatus) {
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: status } });
      changed = true;
    }
    if (changed) await recordOrderChange(tx, order);
  }

  private async toIssues(rows: LedgerRow[]): Promise<AdminSyncIssue[]> {
    const userIds = [...new Set(rows.flatMap((r) => (r.resolvedById ? [r.resolvedById] : [])))];
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true },
        })
      ).map((u) => [u.id, u.displayName]),
    );
    return rows.map((r) => ({
      operationId: r.operationId,
      deviceId: r.deviceId,
      entityType: r.entityType,
      entityId: r.entityId,
      operationType: r.operationType,
      entityVersion: r.entityVersion,
      status: r.status,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      attempts: r.attempts,
      label: str(asRecord(r.payload).orderNumber),
      hasPayload: r.payload !== null,
      resolution: r.resolution,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedById ? (names.get(r.resolvedById) ?? null) : null,
      resolutionNote: r.resolutionNote,
      resendRequestedAt: r.resendRequestedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
