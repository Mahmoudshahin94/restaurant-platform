import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import { newId } from '@pos/domain';
import { PrismaService, type PrismaTx, RequestContext, redactForAudit } from '@pos/server';
import type { Paginated, PlatformAuditEntry, platformAuditQuerySchema } from '@pos/validation';
import type { z } from 'zod';

export interface PlatformAuditRecord {
  /** Dot-namespaced verb: `platform_auth.login`, `tenant.status_changed`, `support.executed`. */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** The tenant the action concerned. */
  tenantId?: string | null;
  metadata?: Record<string, unknown>;
  /** Defaults to the request's platform operator. */
  actorId?: string | null;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The platform's own audit trail (ADR 0025), append-only (the table refuses updates and deletes).
 * Metadata is redacted when written and again when read, like a tenant's audit log.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: PlatformAuditRecord, tx: PrismaTx = this.prisma): Promise<string> {
    const ctx = RequestContext.get();
    const id = newId();
    await tx.platformAuditLog.create({
      data: {
        id,
        actorId: entry.actorId !== undefined ? entry.actorId : (ctx?.platformUserId ?? null),
        subjectTenantId: entry.tenantId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: redactForAudit(entry.metadata ?? {}) as Prisma.InputJsonValue,
        requestId: ctx?.requestId ?? null,
      },
    });
    return id;
  }

  async search(
    q: z.output<typeof platformAuditQuerySchema>,
  ): Promise<Paginated<PlatformAuditEntry>> {
    const where: Prisma.PlatformAuditLogWhereInput = {
      ...(q.tenantId ? { subjectTenantId: q.tenantId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action
        ? q.action.endsWith('.')
          ? { action: { startsWith: q.action } }
          : { action: q.action }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const actors = await this.prisma.platformUser.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, displayName: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.displayName]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actorId: r.actorId,
        actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
        tenantId: r.subjectTenantId,
        requestId: r.requestId,
        metadata: asObject(redactForAudit(r.metadata)),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }
}
