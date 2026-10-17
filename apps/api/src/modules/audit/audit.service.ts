import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import { RequestContext } from '../../common/context/request-context';
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
  restaurantId?: string | null;
  locationId?: string | null;
}

/** Append-only audit trail. Pass the transaction client so the record commits with the change. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx: PrismaTx = this.prisma): Promise<void> {
    const ctx = RequestContext.get();
    const actorId = entry.actorId !== undefined ? entry.actorId : (ctx?.userId ?? null);
    await tx.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: redactForAudit(entry.metadata ?? {}) as Prisma.InputJsonValue,
        actorType: entry.actorType ?? (actorId ? 'USER' : 'SYSTEM'),
        actorId,
        restaurantId:
          entry.restaurantId !== undefined ? entry.restaurantId : (ctx?.restaurantId ?? null),
        locationId: entry.locationId !== undefined ? entry.locationId : (ctx?.locationId ?? null),
        source: ctx?.source ?? 'SYSTEM',
        requestId: ctx?.requestId ?? null,
      },
    });
  }
}
