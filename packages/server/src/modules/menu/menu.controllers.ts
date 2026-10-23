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
@Controller('tenants/:tenantId/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(
    @Param('tenantId', id) tenantId: string,
    @Query(listQuery) q: ListQuery,
  ): Promise<Category[]> {
    return this.categories.list(tenantId, q.includeArchived);
  }

  @RequirePermissions(['products.create'])
  @Post()
  create(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(createCategorySchema)) body: z.output<typeof createCategorySchema>,
  ): Promise<Category> {
    return this.categories.create(tenantId, body);
  }

  @RequirePermissions(['products.update'])
  @Patch(':categoryId')
  update(
    @Param('tenantId', id) tenantId: string,
    @Param('categoryId', id) categoryId: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: z.output<typeof updateCategorySchema>,
  ): Promise<Category> {
    return this.categories.update(tenantId, categoryId, body);
  }

  @RequirePermissions(['products.delete'])
  @Post(':categoryId/archive')
  @HttpCode(200)
  archive(
    @Param('tenantId', id) tenantId: string,
    @Param('categoryId', id) categoryId: string,
  ): Promise<Category> {
    return this.categories.setArchived(tenantId, categoryId, true);
  }

  @RequirePermissions(['products.update'])
  @Post(':categoryId/restore')
  @HttpCode(200)
  restore(
    @Param('tenantId', id) tenantId: string,
    @Param('categoryId', id) categoryId: string,
  ): Promise<Category> {
    return this.categories.setArchived(tenantId, categoryId, false);
  }
}

@ManagedInCloud()
@Controller('tenants/:tenantId/kitchen-stations')
export class KitchenStationsController {
  constructor(private readonly stations: KitchenStationsService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(
    @Param('tenantId', id) tenantId: string,
    @Query(listQuery) q: ListQuery,
  ): Promise<KitchenStation[]> {
    return this.stations.list(tenantId, q.includeArchived);
  }

  @RequirePermissions(['products.create'])
  @Post()
  create(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(createKitchenStationSchema))
    body: z.output<typeof createKitchenStationSchema>,
  ): Promise<KitchenStation> {
    return this.stations.create(tenantId, body);
  }

  @RequirePermissions(['products.update'])
  @Patch(':stationId')
  update(
    @Param('tenantId', id) tenantId: string,
    @Param('stationId', id) stationId: string,
    @Body(new ZodValidationPipe(updateKitchenStationSchema))
    body: z.output<typeof updateKitchenStationSchema>,
  ): Promise<KitchenStation> {
    return this.stations.update(tenantId, stationId, body);
  }

  @RequirePermissions(['products.delete'])
  @Post(':stationId/archive')
  @HttpCode(200)
  archive(
    @Param('tenantId', id) tenantId: string,
    @Param('stationId', id) stationId: string,
  ): Promise<KitchenStation> {
    return this.stations.setArchived(tenantId, stationId, true);
  }

  @RequirePermissions(['products.update'])
  @Post(':stationId/restore')
  @HttpCode(200)
  restore(
    @Param('tenantId', id) tenantId: string,
    @Param('stationId', id) stationId: string,
  ): Promise<KitchenStation> {
    return this.stations.setArchived(tenantId, stationId, false);
  }
}

@ManagedInCloud()
@Controller('tenants/:tenantId/modifier-groups')
export class ModifierGroupsController {
  constructor(private readonly groups: ModifierGroupsService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(
    @Param('tenantId', id) tenantId: string,
    @Query(listQuery) q: ListQuery,
  ): Promise<ModifierGroup[]> {
    return this.groups.list(tenantId, q.includeArchived);
  }

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get(':groupId')
  get(
    @Param('tenantId', id) tenantId: string,
    @Param('groupId', id) groupId: string,
  ): Promise<ModifierGroup> {
    return this.groups.get(tenantId, groupId);
  }

  @RequirePermissions(['products.create'])
  @Post()
  create(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(createModifierGroupSchema))
    body: z.output<typeof createModifierGroupSchema>,
  ): Promise<ModifierGroup> {
    return this.groups.create(tenantId, body);
  }

  @RequirePermissions(['products.update'])
  @Patch(':groupId')
  update(
    @Param('tenantId', id) tenantId: string,
    @Param('groupId', id) groupId: string,
    @Body(new ZodValidationPipe(updateModifierGroupSchema))
    body: z.output<typeof updateModifierGroupSchema>,
  ): Promise<ModifierGroup> {
    return this.groups.update(tenantId, groupId, body);
  }

  @RequirePermissions(['products.delete'])
  @Post(':groupId/archive')
  @HttpCode(200)
  archive(
    @Param('tenantId', id) tenantId: string,
    @Param('groupId', id) groupId: string,
  ): Promise<ModifierGroup> {
    return this.groups.setArchived(tenantId, groupId, true);
  }

  @RequirePermissions(['products.update'])
  @Post(':groupId/restore')
  @HttpCode(200)
  restore(
    @Param('tenantId', id) tenantId: string,
    @Param('groupId', id) groupId: string,
  ): Promise<ModifierGroup> {
    return this.groups.setArchived(tenantId, groupId, false);
  }
}

@ManagedInCloud()
@Controller('tenants/:tenantId/products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(
    @Param('tenantId', id) tenantId: string,
    @Query(new ZodValidationPipe(listProductsQuerySchema))
    query: z.output<typeof listProductsQuerySchema>,
  ): Promise<Product[]> {
    return this.products.list(tenantId, query);
  }

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get(':productId')
  get(
    @Param('tenantId', id) tenantId: string,
    @Param('productId', id) productId: string,
  ): Promise<Product> {
    return this.products.get(tenantId, productId);
  }

  @RequirePermissions(['products.create'])
  @Post()
  create(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(createProductSchema)) body: z.output<typeof createProductSchema>,
  ): Promise<Product> {
    return this.products.create(tenantId, body);
  }

  @RequirePermissions(['products.update'])
  @Patch(':productId')
  update(
    @Param('tenantId', id) tenantId: string,
    @Param('productId', id) productId: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: z.output<typeof updateProductSchema>,
  ): Promise<Product> {
    return this.products.update(tenantId, productId, body);
  }

  @RequirePermissions(['products.delete'])
  @Post(':productId/archive')
  @HttpCode(200)
  archive(
    @Param('tenantId', id) tenantId: string,
    @Param('productId', id) productId: string,
  ): Promise<Product> {
    return this.products.setArchived(tenantId, productId, true);
  }

  @RequirePermissions(['products.update'])
  @Post(':productId/restore')
  @HttpCode(200)
  restore(
    @Param('tenantId', id) tenantId: string,
    @Param('productId', id) productId: string,
  ): Promise<Product> {
    return this.products.setArchived(tenantId, productId, false);
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
    return this.menus.setProductSetting(scope.tenantId, locationId, productId, body);
  }
}
