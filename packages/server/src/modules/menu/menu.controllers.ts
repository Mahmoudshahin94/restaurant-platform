import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type Category,
  type KitchenStation,
  type LocationProductSetting,
  type ModifierGroup,
  type Product,
  type PublishedMenu,
  createCategorySchema,
  createKitchenStationSchema,
  createModifierGroupSchema,
  createProductSchema,
  idSchema,
  listProductsQuerySchema,
  listQuerySchema,
  setLocationProductSchema,
  updateCategorySchema,
  updateKitchenStationSchema,
  updateModifierGroupSchema,
  updateProductSchema,
} from '@pos/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { CurrentScope, RequirePermissions, type RequestScope } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CategoriesService } from './categories.service';
import { KitchenStationsService } from './kitchen-stations.service';
import { ModifierGroupsService } from './modifier-groups.service';
import { ProductsService } from './products.service';
import { PublishedMenuService } from './published-menu.service';
import { ManagedInCloud } from '../../common/auth/managed-in-cloud';

const id = new ZodValidationPipe(idSchema);
const listQuery = new ZodValidationPipe(listQuerySchema);
type ListQuery = z.output<typeof listQuerySchema>;

@ManagedInCloud()
@Controller('restaurants/:restaurantId/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(
    @Param('restaurantId', id) restaurantId: string,
    @Query(listQuery) q: ListQuery,
  ): Promise<Category[]> {
    return this.categories.list(restaurantId, q.includeArchived);
  }

  @RequirePermissions(['products.create'])
  @Post()
  create(
    @Param('restaurantId', id) restaurantId: string,
    @Body(new ZodValidationPipe(createCategorySchema)) body: z.output<typeof createCategorySchema>,
  ): Promise<Category> {
    return this.categories.create(restaurantId, body);
  }

  @RequirePermissions(['products.update'])
  @Patch(':categoryId')
  update(
    @Param('restaurantId', id) restaurantId: string,
    @Param('categoryId', id) categoryId: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: z.output<typeof updateCategorySchema>,
  ): Promise<Category> {
    return this.categories.update(restaurantId, categoryId, body);
  }

  @RequirePermissions(['products.delete'])
  @Post(':categoryId/archive')
  @HttpCode(200)
  archive(
    @Param('restaurantId', id) restaurantId: string,
    @Param('categoryId', id) categoryId: string,
  ): Promise<Category> {
    return this.categories.setArchived(restaurantId, categoryId, true);
  }

  @RequirePermissions(['products.update'])
  @Post(':categoryId/restore')
  @HttpCode(200)
  restore(
    @Param('restaurantId', id) restaurantId: string,
    @Param('categoryId', id) categoryId: string,
  ): Promise<Category> {
    return this.categories.setArchived(restaurantId, categoryId, false);
  }
}

@ManagedInCloud()
@Controller('restaurants/:restaurantId/kitchen-stations')
export class KitchenStationsController {
  constructor(private readonly stations: KitchenStationsService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(
    @Param('restaurantId', id) restaurantId: string,
    @Query(listQuery) q: ListQuery,
  ): Promise<KitchenStation[]> {
    return this.stations.list(restaurantId, q.includeArchived);
  }

  @RequirePermissions(['products.create'])
  @Post()
  create(
    @Param('restaurantId', id) restaurantId: string,
    @Body(new ZodValidationPipe(createKitchenStationSchema))
    body: z.output<typeof createKitchenStationSchema>,
  ): Promise<KitchenStation> {
    return this.stations.create(restaurantId, body);
  }

  @RequirePermissions(['products.update'])
  @Patch(':stationId')
  update(
    @Param('restaurantId', id) restaurantId: string,
    @Param('stationId', id) stationId: string,
    @Body(new ZodValidationPipe(updateKitchenStationSchema))
    body: z.output<typeof updateKitchenStationSchema>,
  ): Promise<KitchenStation> {
    return this.stations.update(restaurantId, stationId, body);
  }

  @RequirePermissions(['products.delete'])
  @Post(':stationId/archive')
  @HttpCode(200)
  archive(
    @Param('restaurantId', id) restaurantId: string,
    @Param('stationId', id) stationId: string,
  ): Promise<KitchenStation> {
    return this.stations.setArchived(restaurantId, stationId, true);
  }

  @RequirePermissions(['products.update'])
  @Post(':stationId/restore')
  @HttpCode(200)
  restore(
    @Param('restaurantId', id) restaurantId: string,
    @Param('stationId', id) stationId: string,
  ): Promise<KitchenStation> {
    return this.stations.setArchived(restaurantId, stationId, false);
  }
}

@ManagedInCloud()
@Controller('restaurants/:restaurantId/modifier-groups')
export class ModifierGroupsController {
  constructor(private readonly groups: ModifierGroupsService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(
    @Param('restaurantId', id) restaurantId: string,
    @Query(listQuery) q: ListQuery,
  ): Promise<ModifierGroup[]> {
    return this.groups.list(restaurantId, q.includeArchived);
  }

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get(':groupId')
  get(
    @Param('restaurantId', id) restaurantId: string,
    @Param('groupId', id) groupId: string,
  ): Promise<ModifierGroup> {
    return this.groups.get(restaurantId, groupId);
  }

  @RequirePermissions(['products.create'])
  @Post()
  create(
    @Param('restaurantId', id) restaurantId: string,
    @Body(new ZodValidationPipe(createModifierGroupSchema))
    body: z.output<typeof createModifierGroupSchema>,
  ): Promise<ModifierGroup> {
    return this.groups.create(restaurantId, body);
  }

  @RequirePermissions(['products.update'])
  @Patch(':groupId')
  update(
    @Param('restaurantId', id) restaurantId: string,
    @Param('groupId', id) groupId: string,
    @Body(new ZodValidationPipe(updateModifierGroupSchema))
    body: z.output<typeof updateModifierGroupSchema>,
  ): Promise<ModifierGroup> {
    return this.groups.update(restaurantId, groupId, body);
  }

  @RequirePermissions(['products.delete'])
  @Post(':groupId/archive')
  @HttpCode(200)
  archive(
    @Param('restaurantId', id) restaurantId: string,
    @Param('groupId', id) groupId: string,
  ): Promise<ModifierGroup> {
    return this.groups.setArchived(restaurantId, groupId, true);
  }

  @RequirePermissions(['products.update'])
  @Post(':groupId/restore')
  @HttpCode(200)
  restore(
    @Param('restaurantId', id) restaurantId: string,
    @Param('groupId', id) groupId: string,
  ): Promise<ModifierGroup> {
    return this.groups.setArchived(restaurantId, groupId, false);
  }
}

@ManagedInCloud()
@Controller('restaurants/:restaurantId/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(
    @Param('restaurantId', id) restaurantId: string,
    @Query(new ZodValidationPipe(listProductsQuerySchema))
    query: z.output<typeof listProductsQuerySchema>,
  ): Promise<Product[]> {
    return this.products.list(restaurantId, query);
  }

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get(':productId')
  get(
    @Param('restaurantId', id) restaurantId: string,
    @Param('productId', id) productId: string,
  ): Promise<Product> {
    return this.products.get(restaurantId, productId);
  }

  @RequirePermissions(['products.create'])
  @Post()
  create(
    @Param('restaurantId', id) restaurantId: string,
    @Body(new ZodValidationPipe(createProductSchema)) body: z.output<typeof createProductSchema>,
  ): Promise<Product> {
    return this.products.create(restaurantId, body);
  }

  @RequirePermissions(['products.update'])
  @Patch(':productId')
  update(
    @Param('restaurantId', id) restaurantId: string,
    @Param('productId', id) productId: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: z.output<typeof updateProductSchema>,
  ): Promise<Product> {
    return this.products.update(restaurantId, productId, body);
  }

  @RequirePermissions(['products.delete'])
  @Post(':productId/archive')
  @HttpCode(200)
  archive(
    @Param('restaurantId', id) restaurantId: string,
    @Param('productId', id) productId: string,
  ): Promise<Product> {
    return this.products.setArchived(restaurantId, productId, true);
  }

  @RequirePermissions(['products.update'])
  @Post(':productId/restore')
  @HttpCode(200)
  restore(
    @Param('restaurantId', id) restaurantId: string,
    @Param('productId', id) productId: string,
  ): Promise<Product> {
    return this.products.setArchived(restaurantId, productId, false);
  }
}

@ManagedInCloud()
@Controller('locations/:locationId')
export class LocationMenuController {
  constructor(private readonly menus: PublishedMenuService) {}

  /**
   * The resolved menu for one location. Supports conditional requests: clients send the
   * previous `version` as `If-None-Match` and get `304` when nothing changed.
   */
  @RequirePermissions(['products.view'])
  @Get('menu')
  async menu(
    @Param('locationId', id) locationId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublishedMenu | undefined> {
    const menu = await this.menus.getForLocation(locationId);
    const etag = `"${menu.version}"`;
    void reply.header('etag', etag).header('cache-control', 'private, no-cache');
    if (request.headers['if-none-match'] === etag) {
      void reply.status(304);
      return undefined;
    }
    return menu;
  }

  @RequirePermissions(['products.view'])
  @Get('product-settings')
  settings(@Param('locationId', id) locationId: string): Promise<LocationProductSetting[]> {
    return this.menus.listSettings(locationId);
  }

  @RequirePermissions(['products.update'])
  @Put('products/:productId/settings')
  setProduct(
    @Param('locationId', id) locationId: string,
    @Param('productId', id) productId: string,
    @CurrentScope() scope: RequestScope,
    @Body(new ZodValidationPipe(setLocationProductSchema))
    body: z.output<typeof setLocationProductSchema>,
  ): Promise<LocationProductSetting> {
    return this.menus.setProductSetting(scope.restaurantId, locationId, productId, body);
  }
}
