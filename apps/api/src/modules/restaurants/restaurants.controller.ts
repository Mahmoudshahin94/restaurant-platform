import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  type Restaurant,
  type UpdateRestaurantRequest,
  idSchema,
  updateRestaurantSchema,
} from '@pos/validation';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { RestaurantsService } from './restaurants.service';

@Controller('restaurants/:restaurantId')
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  /** Any member of the restaurant may read its basic settings (currency, locale, timezone). */
  @RequirePermissions([])
  @Get()
  get(
    @Param('restaurantId', new ZodValidationPipe(idSchema)) restaurantId: string,
  ): Promise<Restaurant> {
    return this.restaurants.get(restaurantId);
  }

  @RequirePermissions(['settings.manage'])
  @Patch()
  update(
    @Param('restaurantId', new ZodValidationPipe(idSchema)) restaurantId: string,
    @Body(new ZodValidationPipe(updateRestaurantSchema)) body: UpdateRestaurantRequest,
  ): Promise<Restaurant> {
    return this.restaurants.update(restaurantId, body);
  }
}
