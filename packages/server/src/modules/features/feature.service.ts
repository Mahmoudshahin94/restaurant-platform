import { Injectable } from '@nestjs/common';
import { DomainError, featureLayersFromRows, resolveFeatures } from '@pos/domain';
import type { Feature, ResolvedFeatures } from '@pos/shared-types';
import { RequestContext } from '../../common/context/request-context';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';

/** Whose modules: a tenant, one of its locations, or one device at that location. */
export interface FeatureScope {
  tenantId: string;
  locationId?: string | null;
  deviceId?: string | null;
}

export interface ResolveOptions {
  /** The caller's transaction: reads inside it see its writes (and SQLite has one writer). */
  db?: PrismaTx;
  /**
   * Where results are kept for the rest of the request. Defaults to the request context's memo;
   * `null` always reads the database (after a change).
   */
  memo?: Map<string, unknown> | null;
}

/** The overrides that can apply to a scope: tenant-wide, the location's and the device's. */
export function overridesWhere(scope: FeatureScope) {
  return {
    tenantId: scope.tenantId,
    OR: [
      { locationId: null, deviceId: null },
      ...(scope.locationId ? [{ locationId: scope.locationId, deviceId: null }] : []),
      ...(scope.deviceId ? [{ deviceId: scope.deviceId }] : []),
    ],
  };
}

/**
 * Answers which modules are on (ADR 0018), on the cloud and on a location hub alike: the hub has
 * the same entitlement and override rows from its snapshot, so it enforces modules offline.
 * Results are memoized per request, so a guard and the handler behind it read the database once.
 */
@Injectable()
export class FeatureService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(scope: FeatureScope, options: ResolveOptions = {}): Promise<ResolvedFeatures> {
    const memo = options.memo === undefined ? RequestContext.get()?.memo : options.memo;
    if (!memo) return this.load(scope, options.db);
    const key = `features:${scope.tenantId}:${scope.locationId ?? ''}:${scope.deviceId ?? ''}`;
    const cached = memo.get(key) as Promise<ResolvedFeatures> | undefined;
    if (cached) return cached;
    const pending = this.load(scope, options.db);
    memo.set(key, pending);
    pending.catch(() => memo.delete(key));
    return pending;
  }

  async isEnabled(
    feature: Feature,
    scope: FeatureScope,
    options: ResolveOptions = {},
  ): Promise<boolean> {
    return (await this.resolve(scope, options))[feature].enabled;
  }

  /** Throws `FEATURE_DISABLED` (403) unless every module is on for the scope. */
  async assertEnabled(
    features: Feature | readonly Feature[],
    scope: FeatureScope,
    options: ResolveOptions = {},
  ): Promise<void> {
    const resolved = await this.resolve(scope, options);
    for (const feature of typeof features === 'string' ? [features] : features) {
      if (!resolved[feature].enabled) {
        throw new DomainError('FEATURE_DISABLED', `The ${feature} module is off`, { feature });
      }
    }
  }

  private async load(scope: FeatureScope, db: PrismaTx = this.prisma): Promise<ResolvedFeatures> {
    return TenantContext.runInTenant(scope.tenantId, async () => {
      const tenant = await db.tenant.findUnique({
        where: { id: scope.tenantId },
        select: { businessType: true },
      });
      if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
      const entitlements = await db.tenantEntitlement.findMany({
        where: { tenantId: scope.tenantId },
      });
      const overrides = await db.featureOverride.findMany({ where: overridesWhere(scope) });
      return resolveFeatures(
        featureLayersFromRows({
          businessType: tenant.businessType,
          entitlements,
          overrides,
          locationId: scope.locationId ?? null,
          deviceId: scope.deviceId ?? null,
        }),
      );
    });
  }
}
