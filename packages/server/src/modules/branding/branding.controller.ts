import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { type TenantBrandingDto, idSchema, updateBrandingSchema } from '@pos/validation';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ManagedInCloud } from '../../common/auth/managed-in-cloud';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { BrandingService } from './branding.service';

/** The admin's Branding page (ADR 0019). Screens read branding from the tenant context. */
@ManagedInCloud()
@Controller('tenants/:tenantId/branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @RequirePermissions(['settings.manage'])
  @Get()
  get(
    @Param('tenantId', new ZodValidationPipe(idSchema)) tenantId: string,
  ): Promise<TenantBrandingDto> {
    return this.branding.get(tenantId);
  }

  /** Replaces the tenant's branding and its surface overrides. */
  @RequirePermissions(['settings.manage'])
  @Put()
  update(
    @Param('tenantId', new ZodValidationPipe(idSchema)) tenantId: string,
    @Body(new ZodValidationPipe(updateBrandingSchema))
    body: z.output<typeof updateBrandingSchema>,
  ): Promise<TenantBrandingDto> {
    return this.branding.update(tenantId, body);
  }
}
