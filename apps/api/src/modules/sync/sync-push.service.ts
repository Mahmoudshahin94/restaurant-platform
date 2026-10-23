import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import {
  OnlinePaymentsService,
  PrismaService,
  isPrismaKnownError,
  isUniqueViolation,
  loggableError,
} from '@pos/server';
import type { ErrorCode } from '@pos/shared-types';
import {
  type SyncOperationResult,
  type SyncPushRequest,
  type SyncPushResponse,
  syncOperationSchema,
} from '@pos/validation';
import type { AuthenticatedDevice } from '../devices/device.guard';
import { type ApplyHooks, SyncRefusal, applyOperation } from './apply-operation';
import { recordOrderChange } from './web-order-change.recorder';

type Envelope = SyncPushRequest['operations'][number];

/** PostgreSQL CHECK violations reach Prisma 6 as unknown request errors (SQLSTATE 23514). */
const isCheckViolation = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('violates check constraint');

const result = (
  operationId: string,
  status: SyncOperationResult['status'],
  code: ErrorCode | null = null,
  message: string | null = null,
): SyncOperationResult => ({ operationId, status, code, message });

/**
 * Ingests a hub's outbox (ADR 0012). Each operation runs in its own transaction together with its
 * ledger row, so it is applied exactly once: a repeat returns DUPLICATE, and of two concurrent
 * deliveries only one can commit. Refusals are recorded for administrators.
 */
@Injectable()
export class SyncPushService {
  private readonly logger = new Logger(SyncPushService.name);
  private readonly hooks: ApplyHooks;

  constructor(
    private readonly prisma: PrismaService,
    payments: OnlinePaymentsService,
  ) {
    this.hooks = {
      voidOnlinePayments: (tx, orderId, reason) => payments.voidAll(tx, orderId, reason),
      recordOrderChange,
    };
  }

  async push(device: AuthenticatedDevice, request: SyncPushRequest): Promise<SyncPushResponse> {
    const results: SyncOperationResult[] = [];
    for (const envelope of request.operations) {
      results.push(await this.processOne(device, envelope));
    }
    if (request.outbox) await this.reportOutbox(device, request.outbox);
    return { results };
  }

  private async processOne(
    device: AuthenticatedDevice,
    envelope: Envelope,
  ): Promise<SyncOperationResult> {
    const parsed = syncOperationSchema.safeParse(envelope);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid operation';
      return this.refuse(device, envelope, new SyncRefusal('REJECTED', 'VALIDATION_FAILED', where));
    }
    const op = parsed.data;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const ledger = await tx.$queryRaw<
            { status: string; entity_id: string; resolution: string | null }[]
          >`
            SELECT status, entity_id, resolution FROM processed_operations
            WHERE operation_id = ${op.operationId}::uuid FOR UPDATE`;
          const previous = ledger[0];
          if (previous && previous.entity_id !== op.entityId) {
            const message = 'Operation id already used for another entity';
            return result(op.operationId, 'REJECTED', 'SYNC_REJECTED', message);
          }
          if (previous?.status === 'APPLIED') return result(op.operationId, 'DUPLICATE');
          if (previous?.resolution === 'KEPT_CLOUD') {
            // An administrator kept the cloud's version (ADR 0014): this change is settled.
            const message = 'An administrator kept the cloud’s version';
            return result(op.operationId, 'DUPLICATE', 'SYNC_SUPERSEDED', message);
          }
          const applied = await applyOperation(tx, device, op, this.hooks);
          const row = {
            status: 'APPLIED' as const,
            rowVersion: applied.rowVersion,
            errorCode: null,
            errorMessage: null,
          };
          if (previous) {
            await tx.processedOperation.update({
              where: { operationId: op.operationId },
              data: { ...row, attempts: { increment: 1 } },
            });
          } else {
            await tx.processedOperation.create({ data: { ...this.ledgerKey(device, op), ...row } });
          }
          return result(op.operationId, 'APPLIED');
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } catch (error) {
      return this.handleFailure(device, op, error);
    }
  }

  private async handleFailure(
    device: AuthenticatedDevice,
    op: Envelope,
    error: unknown,
  ): Promise<SyncOperationResult> {
    if (error instanceof SyncRefusal) return this.refuse(device, op, error);
    if (isUniqueViolation(error)) {
      // A concurrent delivery of the same operation may have committed first.
      const ledger = await this.prisma.processedOperation.findUnique({
        where: { operationId: op.operationId },
        select: { status: true },
      });
      if (ledger?.status === 'APPLIED') return result(op.operationId, 'DUPLICATE');
      const target = JSON.stringify((error as { meta?: { target?: unknown } }).meta?.target ?? '');
      return this.refuse(
        device,
        op,
        new SyncRefusal('CONFLICT', 'SYNC_CONFLICT', `Unique constraint ${target} violated`),
      );
    }
    if (isPrismaKnownError(error, 'P2003') || isPrismaKnownError(error, 'P2025')) {
      // A referenced row (dependency or catalog entry) is not in the cloud (yet).
      return this.refuse(
        device,
        op,
        new SyncRefusal('RETRY', 'SYNC_DEPENDENCY_MISSING', 'A referenced row is missing'),
      );
    }
    if (isCheckViolation(error)) {
      // The database's own invariants (e.g. a manual cash movement needs a reason).
      return this.refuse(
        device,
        op,
        new SyncRefusal('REJECTED', 'SYNC_REJECTED', 'The data breaks a database rule'),
      );
    }
    const { message, stack } = loggableError(error);
    this.logger.error(message, stack);
    return result(op.operationId, 'RETRY', 'INTERNAL_ERROR', 'Unexpected error; retry later');
  }

  /**
   * Records the refusal (never over an APPLIED or settled row) with the hub's state, so an
   * administrator can compare and decide (ADR 0014), and answers the hub.
   */
  private async refuse(
    device: AuthenticatedDevice,
    op: Envelope,
    refusal: SyncRefusal,
  ): Promise<SyncOperationResult> {
    // RETRY is not a decision about the operation; only lasting refusals are kept for admins.
    if (refusal.status !== 'RETRY') {
      const status = refusal.status;
      const payload = JSON.stringify(op.payload ?? null);
      await this.prisma.$executeRaw`
        INSERT INTO processed_operations (operation_id, tenant_id, location_id, device_id,
          entity_type, entity_id, operation_type, entity_version, status, error_code,
          error_message, attempts, payload, updated_at)
        VALUES (${op.operationId}::uuid, ${device.tenantId}::uuid, ${device.locationId}::uuid,
          ${device.id}::uuid, ${op.entityType}, ${op.entityId}::uuid, ${op.operationType},
          ${op.entityVersion}, ${status}::processed_operation_status, ${refusal.code},
          ${refusal.message}, 1, ${payload}::jsonb, now())
        ON CONFLICT (operation_id) DO UPDATE SET
          status = EXCLUDED.status, error_code = EXCLUDED.error_code,
          error_message = EXCLUDED.error_message, payload = EXCLUDED.payload,
          attempts = processed_operations.attempts + 1, updated_at = now()
        WHERE processed_operations.status <> 'APPLIED'
          AND processed_operations.resolution IS NULL`;
    }
    return result(op.operationId, refusal.status, refusal.code, refusal.message);
  }

  private ledgerKey(device: AuthenticatedDevice, op: Envelope) {
    return {
      operationId: op.operationId,
      tenantId: device.tenantId,
      locationId: device.locationId,
      deviceId: device.id,
      entityType: op.entityType,
      entityId: op.entityId,
      operationType: op.operationType,
      entityVersion: op.entityVersion,
    } satisfies Partial<Prisma.ProcessedOperationUncheckedCreateInput>;
  }

  /** The hub's outbox size, kept on the device for the admin portal. */
  private async reportOutbox(
    device: AuthenticatedDevice,
    outbox: NonNullable<SyncPushRequest['outbox']>,
  ): Promise<void> {
    const row = await this.prisma.device.findUnique({
      where: { id: device.id },
      select: { metadata: true },
    });
    const metadata =
      row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {};
    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        metadata: { ...metadata, outbox: { ...outbox, reportedAt: new Date().toISOString() } },
      },
    });
  }
}
