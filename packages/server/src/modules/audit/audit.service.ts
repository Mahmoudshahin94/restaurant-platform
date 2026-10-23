import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import { newId } from '@pos/domain';
import { RequestContext } from '../../common/context/request-context';
import { ChangeRecorder } from '../../prisma/change-recorder';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { redactForAudit } from './redact';

export type ActorType = 'USER' | 'EMPLOYEE' | 'DEVICE' | 'CUSTOMER' | 'SYSTEM';

export interface AuditEntry {
  /** Dot-namespaced verb, e.g. `auth.login`, `location.updated`, `product.price_changed`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Defaults come from the request context; override for events without one (e.g. login). */
  actorType?: ActorType;
  actorId?: string | null;
  tenantId?: string | null;
  locationId?: string | null;
}

/**
 * Append-only audit trail. Pass the transaction client so the record commits with the change. On
 * the location hub each entry also goes to the sync outbox in the same transaction, so the cloud's
 * audit log receives what happened at the location (ADR 0016).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ChangeRecorder,
  ) {}

  async record(entry: AuditEntry, tx?: PrismaTx): Promise<void> {
    if (tx) return this.write(entry, tx);
    if (!this.changes.capturesAudit) return this.write(entry, this.prisma);
    await this.prisma.$transaction((t) => this.write(entry, t));
  }

  private async write(entry: AuditEntry, tx: PrismaTx): Promise<void> {
    const ctx = RequestContext.get();
    const actorId = entry.actorId !== undefined ? entry.actorId : (ctx?.userId ?? null);
    const id = newId();
    await tx.auditLog.create({
      data: {
        id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: redactForAudit(entry.metadata ?? {}) as Prisma.InputJsonValue,
        actorType: entry.actorType ?? (actorId ? 'USER' : 'SYSTEM'),
        actorId,
        tenantId: entry.tenantId !== undefined ? entry.tenantId : (ctx?.tenantId ?? null),
        locationId: entry.locationId !== undefined ? entry.locationId : (ctx?.locationId ?? null),
        source: ctx?.source ?? 'SYSTEM',
        requestId: ctx?.requestId ?? null,
      },
    });
    await this.changes.record(tx, { auditIds: [id] });
  }
}
