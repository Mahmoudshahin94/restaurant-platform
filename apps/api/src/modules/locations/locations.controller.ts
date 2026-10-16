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

const idPipe = new ZodValidationPipe(idSchema);

@Controller()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @RequirePermissions(['locations.view'], { scope: 'any-location' })
  @Get('restaurants/:restaurantId/locations')
  list(
    @Param('restaurantId', idPipe) _restaurantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Location[]> {
    return this.locations.list(principal);
  }

  @RequirePermissions(['settings.manage'])
  @Post('restaurants/:restaurantId/locations')
  create(
    @Param('restaurantId', idPipe) restaurantId: string,
    @Body(new ZodValidationPipe(createLocationSchema)) body: z.output<typeof createLocationSchema>,
  ): Promise<Location> {
    return this.locations.create(restaurantId, body);
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
