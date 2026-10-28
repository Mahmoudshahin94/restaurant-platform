import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type EntitlementSpec, type Prisma, hashSecret } from '@pos/database';
import {
  DomainError,
  assertTenantAccess,
  assertTenantStatusChange,
  businessTypeDefaults,
} from '@pos/domain';
import {
  APP_CONFIG,
  type AppConfig,
  AuditService,
  BrandingService,
  FeatureService,
  PrismaService,
  TenantContext,
  TenantDomainsService,
  redactForAudit,
  toLocationDto,
  toTenantDto,
} from '@pos/server';
import { DomainStatus, FEATURES, type Feature } from '@pos/shared-types';
import type {
  AdminDevice,
  AuditLogEntry,
  Location,
  Paginated,
  PaymentProvidersOverview,
  PlatformModule,
  PlatformTenantDetail,
  PlatformTenantUser,
  ProvisionedTenantDto,
  TenantBrandingDto,
  TenantDomainDto,
  auditLogQuerySchema,
  changeTenantStatusSchema,
  provisionTenantSchema,
  setEntitlementsSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PaymentProvidersService } from '../../admin/payment-setup/payment-providers.service';
import { toAdminDevice } from '../../devices/devices.service';
import { PlatformAuditService } from '../platform-audit.service';
import { PlatformDirectoryService } from '../platform-directory.service';

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A readable one-time password: 16 URL-safe characters (96 bits). */
const temporaryPassword = () => randomBytes(12).toString('base64url');

/**
 * What the platform admin does with one tenant (ADR 0025). Every call runs inside that tenant's
 * scope (the platform guard scopes routes naming `:tenantId`, and new tenants are entered with
 * `runInTenant`), so the tenant-scoped client confines it as it confines the tenant's own staff.
 * Changes are written to the platform's audit log and to the tenant's, so the business sees what
 * the platform did.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: PlatformDirectoryService,
    private readonly platformAudit: PlatformAuditService,
    private readonly audit: AuditService,
    private readonly features: FeatureService,
    private readonly brandingService: BrandingService,
    private readonly domains: TenantDomainsService,
    private readonly paymentProviders: PaymentProvidersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async provision(input: z.output<typeof provisionTenantSchema>): Promise<ProvisionedTenantDto> {
    const defaults = businessTypeDefaults(input.tenant.businessType);
    const entitlements = Object.fromEntries(
      FEATURES.map((feature): [Feature, EntitlementSpec] => [
        feature,
        input.entitlements?.[feature] ?? {
          entitled: defaults[feature] === true,
          tenantConfigurable: true,
        },
      ]),
    );
    const password = temporaryPassword();
    const provisioned = await this.directory.provision(input, {
      ownerPasswordHash: await hashSecret(password),
      entitlements,
      webDomain: this.config.PLATFORM_WEB_DOMAIN,
    });
    const { tenantId, ownerId } = provisioned;
    const summary = {
      slug: input.tenant.slug,
      businessType: input.tenant.businessType,
      currencyCode: input.tenant.currencyCode,
      location: input.location.code,
      owner: input.owner.email,
      entitled: Object.entries(entitlements)
        .filter(([, spec]) => spec.entitled)
        .map(([feature]) => feature),
    };
    await this.platformAudit.record({
      action: 'tenant.provisioned',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId,
      metadata: summary,
    });
    return TenantContext.runInTenant(tenantId, async () => {
      await this.audit.record({
        action: 'tenant.provisioned',
        entityType: 'Tenant',
        entityId: tenantId,
        tenantId,
        metadata: summary,
      });
      return {
        tenant: await this.detail(tenantId),
        owner: { id: ownerId ?? '', email: input.owner.email, temporaryPassword: password },
      };
    });
  }

  async detail(tenantId: string): Promise<PlatformTenantDetail> {
    const [row, counts, owners, lastOrder, primary] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          _count: { select: { locations: true, users: true, devices: true, orders: true } },
        },
      }),
      this.prisma.user.findMany({
        where: {
          tenantId,
          isActive: true,
          roles: { some: { locationId: null, role: { isSystem: true } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.order.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.tenantDomain.findFirst({
        where: { tenantId, isPrimary: true, status: DomainStatus.VERIFIED },
        select: { domain: true },
      }),
    ]);
    return {
      tenant: toTenantDto(row),
      owners: owners.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      counts: counts._count,
      primaryDomain: primary?.domain ?? null,
      lastActivityAt: lastOrder?.createdAt.toISOString() ?? null,
    };
  }

  /**
   * Suspends, reactivates or archives a tenant (ADR 0025). A suspended tenant's staff, hubs and
   * website are refused from the next request on; an archived one can only be read. Sessions are
   * not revoked: they continue once the tenant is active again.
   */
  async setStatus(
    tenantId: string,
    input: z.output<typeof changeTenantStatusSchema>,
  ): Promise<PlatformTenantDetail> {
    const current = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { status: true },
    });
    if (current.status === input.status) return this.detail(tenantId);
    assertTenantStatusChange(current.status, input.status);
    const metadata = { from: current.status, to: input.status, reason: input.reason };
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.tenant.updateMany({
        where: { id: tenantId, status: current.status },
        data: { status: input.status },
      });
      if (claimed.count !== 1) {
        throw new DomainError('CONFLICT', 'The status changed meanwhile', { reason: 'STALE' });
      }
      await this.audit.record(
        { action: 'tenant.status_changed', entityType: 'Tenant', entityId: tenantId, metadata },
        tx,
      );
      await this.platformAudit.record(
        {
          action: 'tenant.status_changed',
          entityType: 'Tenant',
          entityId: tenantId,
          tenantId,
          metadata,
        },
        tx,
      );
    });
    return this.detail(tenantId);
  }

  async locations(tenantId: string): Promise<Location[]> {
    const rows = await this.prisma.location.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
    return rows.map(toLocationDto);
  }

  /** Accounts and their roles; never a password hash. */
  async users(tenantId: string): Promise<PlatformTenantUser[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
      select: {
        id: true,
        email: true,
        displayName: true,
        isActive: true,
        lastLoginAt: true,
        roles: { select: { locationId: true, role: { select: { name: true, isSystem: true } } } },
      },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      roles: u.roles.map((r) => ({
        roleName: r.role.name,
        isSystem: r.role.isSystem,
        locationId: r.locationId,
      })),
    }));
  }

  /** Hubs and terminals with the version each last reported and whether it is online. */
  async devices(tenantId: string): Promise<AdminDevice[]> {
    const rows = await this.prisma.device.findMany({
      where: { tenantId },
      orderBy: [{ locationId: 'asc' }, { createdAt: 'desc' }],
    });
    const now = new Date();
    return rows.map((row) => toAdminDevice(row, this.staleAfterMs, now));
  }

  get staleAfterMs(): number {
    return this.config.HUB_HEARTBEAT_STALE_SECONDS * 1000;
  }

  async modules(tenantId: string): Promise<PlatformModule[]> {
    const [tenant, rows, resolved] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { businessType: true },
      }),
      this.prisma.tenantEntitlement.findMany({ where: { tenantId } }),
      this.features.resolve({ tenantId, locationId: null, deviceId: null }),
    ]);
    const defaults = businessTypeDefaults(tenant.businessType);
    const explicit = new Map(rows.map((r) => [r.feature, r]));
    return FEATURES.map((feature) => {
      const row = explicit.get(feature);
      return {
        feature,
        entitled: row?.entitled ?? true,
        tenantConfigurable: row?.tenantConfigurable ?? true,
        explicit: row !== undefined,
        businessTypeDefault: defaults[feature] === true,
        enabled: resolved[feature].enabled,
      };
    });
  }

  /** The platform's decisions on modules (ADR 0018); they reach the hubs through the change feed. */
  async setEntitlements(
    tenantId: string,
    input: z.output<typeof setEntitlementsSchema>,
  ): Promise<PlatformModule[]> {
    await this.assertWritable(tenantId);
    const before = await this.modules(tenantId);
    const changes = input.entitlements.flatMap((next) => {
      const was = before.find((m) => m.feature === next.feature);
      if (!was) return [];
      const same =
        was.entitled === next.entitled && was.tenantConfigurable === next.tenantConfigurable;
      return same
        ? []
        : [
            {
              feature: next.feature,
              before: { entitled: was.entitled, tenantConfigurable: was.tenantConfigurable },
              after: { entitled: next.entitled, tenantConfigurable: next.tenantConfigurable },
            },
          ];
    });
    if (changes.length === 0) return before;
    await this.prisma.$transaction(async (tx) => {
      for (const change of changes) {
        await tx.tenantEntitlement.upsert({
          where: { tenantId_feature: { tenantId, feature: change.feature } },
          update: change.after,
          create: { tenantId, feature: change.feature, ...change.after },
        });
      }
      const metadata = { reason: input.reason, changes };
      await this.audit.record(
        { action: 'entitlements.changed', entityType: 'Tenant', entityId: tenantId, metadata },
        tx,
      );
      await this.platformAudit.record(
        {
          action: 'tenant.entitlements_changed',
          entityType: 'Tenant',
          entityId: tenantId,
          tenantId,
          metadata,
        },
        tx,
      );
    });
    return this.modules(tenantId);
  }

  branding(tenantId: string): Promise<TenantBrandingDto> {
    return this.brandingService.get(tenantId);
  }

  domainList(tenantId: string): Promise<TenantDomainDto[]> {
    return this.domains.list(tenantId);
  }

  /** Looks a custom domain's TXT record up again, on the tenant's behalf (ADR 0023). */
  async verifyDomain(tenantId: string, domainId: string): Promise<TenantDomainDto> {
    await this.assertWritable(tenantId);
    const domain = await this.domains.verify(tenantId, domainId);
    await this.platformAudit.record({
      action: 'tenant.domain_verified',
      entityType: 'TenantDomain',
      entityId: domainId,
      tenantId,
      metadata: { domain: domain.domain, status: domain.status },
    });
    return domain;
  }

  /** Accounts with their secrets' status only (ADR 0024): a secret never leaves the cloud. */
  paymentAccounts(tenantId: string): Promise<PaymentProvidersOverview> {
    return this.paymentProviders.overview(tenantId);
  }

  /** The tenant's own audit log; an actor is named whether a tenant user or a platform user. */
  async auditLogs(
    tenantId: string,
    q: z.output<typeof auditLogQuerySchema>,
  ): Promise<Paginated<AuditLogEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.action
        ? q.action.endsWith('.')
          ? { action: { startsWith: q.action } }
          : { action: q.action }
        : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}),
              ...(q.to
                ? { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) }
                : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const [users, employees, operators] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: actorIds }, tenantId },
        select: { id: true, displayName: true },
      }),
      this.prisma.employee.findMany({
        where: { id: { in: actorIds }, tenantId },
        select: { id: true, displayName: true },
      }),
      this.prisma.platformUser.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, displayName: true },
      }),
    ]);
    const names = new Map([...users, ...employees, ...operators].map((a) => [a.id, a.displayName]));
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

  /** An archived tenant is read-only for the platform's configuration and repairs too. */
  async assertWritable(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { status: true },
    });
    if (tenant.status === 'ARCHIVED') assertTenantAccess(tenant.status, 'write');
  }
}
