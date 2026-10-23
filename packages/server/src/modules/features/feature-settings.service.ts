import { Injectable } from '@nestjs/common';
import { DomainError, featureLayersFromRows, featureSettings } from '@pos/domain';
import type { Feature, FeatureSetting, OverrideLayer } from '@pos/shared-types';
import type { PrismaTx } from '../../prisma/prisma.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type FeatureScope, overridesWhere } from './feature.service';

/** A scope the Modules page edits, with the ids its override row carries. */
interface OverrideScope extends FeatureScope {
  layer: OverrideLayer;
  locationId: string | null;
  deviceId: string | null;
  /** `tenant`, `location:<id>` or `device:<id>`: one override per scope (see the schema). */
  key: string;
}

/**
 * The tenant administrator's side of modules (ADR 0018): the Modules page and its overrides.
 * Entitlements belong to the platform operator; a module outside the plan, or one the platform
 * keeps to itself, cannot be switched here.
 */
@Injectable()
export class FeatureSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    query: { locationId?: string | undefined; deviceId?: string | undefined },
  ): Promise<FeatureSetting[]> {
    const scope = await this.scopeOf(this.prisma, tenantId, query);
    return this.settingsOf(this.prisma, scope);
  }

  async set(
    tenantId: string,
    feature: Feature,
    input: { locationId: string | null; deviceId: string | null; enabled: boolean | null },
  ): Promise<FeatureSetting[]> {
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.scopeOf(tx, tenantId, input);
      const entitlement = await tx.tenantEntitlement.findUnique({
        where: { tenantId_feature: { tenantId, feature } },
      });
      if (entitlement && (!entitlement.entitled || !entitlement.tenantConfigurable)) {
        throw new DomainError(
          'FEATURE_NOT_CONFIGURABLE',
          `The ${feature} module is not yours to switch`,
          {
            feature,
            reason: entitlement.entitled ? 'PLATFORM_MANAGED' : 'NOT_ENTITLED',
          },
        );
      }
      const where = { tenantId_scope_feature: { tenantId, scope: scope.key, feature } };
      const before = await tx.featureOverride.findUnique({ where });
      if (input.enabled === null) {
        if (before) await tx.featureOverride.delete({ where });
      } else {
        await tx.featureOverride.upsert({
          where,
          create: {
            tenantId,
            locationId: scope.locationId,
            deviceId: scope.deviceId,
            scope: scope.key,
            feature,
            enabled: input.enabled,
          },
          update: { enabled: input.enabled },
        });
      }
      if ((before?.enabled ?? null) !== input.enabled) {
        await this.audit.record(
          {
            action: 'feature.override_changed',
            entityType: 'Tenant',
            entityId: tenantId,
            tenantId,
            locationId: scope.locationId,
            metadata: {
              feature,
              layer: scope.layer,
              deviceId: scope.deviceId,
              from: before?.enabled ?? null,
              to: input.enabled,
            },
          },
          tx,
        );
      }
      return this.settingsOf(tx, scope);
    });
  }

  private async settingsOf(db: PrismaTx, scope: OverrideScope): Promise<FeatureSetting[]> {
    const tenant = await db.tenant.findUnique({
      where: { id: scope.tenantId },
      select: { businessType: true },
    });
    if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    const entitlements = await db.tenantEntitlement.findMany({
      where: { tenantId: scope.tenantId },
    });
    const overrides = await db.featureOverride.findMany({ where: overridesWhere(scope) });
    return featureSettings(
      featureLayersFromRows({
        businessType: tenant.businessType,
        entitlements,
        overrides,
        locationId: scope.locationId,
        deviceId: scope.deviceId,
      }),
      scope.layer,
    );
  }

  /** The scope named by the ids, checked to belong to the tenant (404 otherwise). */
  private async scopeOf(
    db: PrismaTx,
    tenantId: string,
    ids: { locationId?: string | null | undefined; deviceId?: string | null | undefined },
  ): Promise<OverrideScope> {
    if (ids.deviceId) {
      const device = await db.device.findFirst({
        where: { id: ids.deviceId, tenantId },
        select: { id: true, locationId: true },
      });
      if (!device || (ids.locationId && ids.locationId !== device.locationId)) {
        throw new DomainError('DEVICE_NOT_FOUND', 'Device not found');
      }
      return {
        tenantId,
        layer: 'DEVICE',
        locationId: device.locationId,
        deviceId: device.id,
        key: `device:${device.id}`,
      };
    }
    if (ids.locationId) {
      const location = await db.location.findFirst({
        where: { id: ids.locationId, tenantId },
        select: { id: true },
      });
      if (!location) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
      return {
        tenantId,
        layer: 'LOCATION',
        locationId: location.id,
        deviceId: null,
        key: `location:${location.id}`,
      };
    }
    return { tenantId, layer: 'TENANT', locationId: null, deviceId: null, key: 'tenant' };
  }
}
