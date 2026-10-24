import { Body, Controller, Get, Param, Patch, Put, Query } from '@nestjs/common';
import {
  type Tenant,
  type TenantContextDto,
  type TenantLocalizationDto,
  type UpdateTenantRequest,
  idSchema,
  tenantContextQuerySchema,
  updateLocalizationSchema,
  updateTenantSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { ManagedInCloud } from '../../common/auth/managed-in-cloud';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { TenantsService } from './tenants.service';

@ManagedInCloud()
@Controller('tenants/:tenantId')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Any member of the tenant may read its basic settings (currency, locale, timezone). */
  @RequirePermissions([])
  @Get()
  get(@Param('tenantId', new ZodValidationPipe(idSchema)) tenantId: string): Promise<Tenant> {
    return this.tenants.get(tenantId);
  }

  /**
   * The tenant as every app renders it: currency, locales, the modules resolved for
   * `?locationId` (ADR 0018) and the branding of `?surface` (ADR 0019). Any member may read it, on
   * the cloud and on the hub.
   */
  @RequirePermissions([])
  @Get('context')
  context(
    @Param('tenantId', new ZodValidationPipe(idSchema)) tenantId: string,
    @Query(new ZodValidationPipe(tenantContextQuerySchema))
    query: z.output<typeof tenantContextQuerySchema>,
  ): Promise<TenantContextDto> {
    return this.tenants.context(tenantId, query.locationId ?? null, query.surface ?? null);
  }

  @RequirePermissions(['settings.manage'])
  @Patch()
  update(
    @Param('tenantId', new ZodValidationPipe(idSchema)) tenantId: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantRequest,
  ): Promise<Tenant> {
    return this.tenants.update(tenantId, body);
  }

  /** Languages and currency display, as set and as resolved (ADR 0020). */
  @RequirePermissions(['settings.manage'])
  @Get('localization')
  localization(
    @Param('tenantId', new ZodValidationPipe(idSchema)) tenantId: string,
  ): Promise<TenantLocalizationDto> {
    return this.tenants.localization(tenantId);
  }

  /** Replaces them; the currency and its decimal places are refused (ADR 0002). */
  @RequirePermissions(['settings.manage'])
  @Put('localization')
  updateLocalization(
    @Param('tenantId', new ZodValidationPipe(idSchema)) tenantId: string,
    @Body(new ZodValidationPipe(updateLocalizationSchema))
    body: z.output<typeof updateLocalizationSchema>,
  ): Promise<TenantLocalizationDto> {
    return this.tenants.updateLocalization(tenantId, body);
  }
}
