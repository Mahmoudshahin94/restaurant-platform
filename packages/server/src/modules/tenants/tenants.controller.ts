import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  type Tenant,
  type UpdateTenantRequest,
  idSchema,
  updateTenantSchema,
} from '@pos/validation';
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

  @RequirePermissions(['settings.manage'])
  @Patch()
  update(
    @Param('tenantId', new ZodValidationPipe(idSchema)) tenantId: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantRequest,
  ): Promise<Tenant> {
    return this.tenants.update(tenantId, body);
  }
}
