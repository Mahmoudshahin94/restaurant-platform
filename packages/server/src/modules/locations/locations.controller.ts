import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  type Location,
  type UpdateLocationRequest,
  createLocationSchema,
  idSchema,
  updateLocationSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { LocationsService } from './locations.service';
import { ManagedInCloud } from '../../common/auth/managed-in-cloud';

const idPipe = new ZodValidationPipe(idSchema);

@ManagedInCloud()
@Controller()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @RequirePermissions(['locations.view'], { scope: 'any-location' })
  @Get('tenants/:tenantId/locations')
  list(
    @Param('tenantId', idPipe) _tenantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Location[]> {
    return this.locations.list(principal);
  }

  @RequirePermissions(['settings.manage'])
  @Post('tenants/:tenantId/locations')
  create(
    @Param('tenantId', idPipe) tenantId: string,
    @Body(new ZodValidationPipe(createLocationSchema)) body: z.output<typeof createLocationSchema>,
  ): Promise<Location> {
    return this.locations.create(tenantId, body);
  }

  @RequirePermissions(['locations.view'])
  @Get('locations/:locationId')
  get(@Param('locationId', idPipe) locationId: string): Promise<Location> {
    return this.locations.get(locationId);
  }

  @RequirePermissions(['settings.manage'])
  @Patch('locations/:locationId')
  update(
    @Param('locationId', idPipe) locationId: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: UpdateLocationRequest,
  ): Promise<Location> {
    return this.locations.update(locationId, body);
  }
}
