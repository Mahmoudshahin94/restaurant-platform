import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import { type Principal, PrismaService, redactForAudit } from '@pos/server';
import type { AuditLogEntry, Paginated, auditLogQuerySchema } from '@pos/validation';
import type { z } from 'zod';
import { holdsTenantWide, instantRange, paging, permittedLocationIds } from '../scope';

/**
 * The audit trail, read-only (`audit.view`). Entries of locations the caller cannot audit are
 * hidden, and tenant-level entries (staff, roles, configuration) need `audit.view`
 * tenant-wide. Metadata was redacted when written and is redacted again here, so a secret
 * can never be shown even if an older entry kept one.
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    principal: Principal,
    q: z.output<typeof auditLogQuerySchema>,
  ): Promise<Paginated<AuditLogEntry>> {
    const locationIds = await permittedLocationIds(
      this.prisma,
      principal,
      ['audit.view'],
      q.locationId,
    );
    const tenantLevel = q.locationId === undefined && holdsTenantWide(principal, 'audit.view');
    const created = instantRange(q.from, q.to);
    const where: Prisma.AuditLogWhereInput = {
      tenantId: principal.tenantId,
      OR: [{ locationId: { in: locationIds } }, ...(tenantLevel ? [{ locationId: null }] : [])],
      ...(q.action
        ? q.action.endsWith('.')
          ? { action: { startsWith: q.action } }
          : { action: q.action }
        : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(created ? { createdAt: created } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paging(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const [users, employees] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: actorIds }, tenantId: principal.tenantId },
        select: { id: true, displayName: true },
      }),
      this.prisma.employee.findMany({
        where: { id: { in: actorIds }, tenantId: principal.tenantId },
        select: { id: true, displayName: true },
      }),
    ]);
    const names = new Map([...users, ...employees].map((a) => [a.id, a.displayName]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actorType: r.actorType,
        actorId: r.actorId,
        actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
        source: r.source,
        locationId: r.locationId,
        requestId: r.requestId,
        metadata: asObject(redactForAudit(r.metadata)),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
