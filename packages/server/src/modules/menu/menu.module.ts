import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { KitchenStationsService } from './kitchen-stations.service';
import {
  CategoriesController,
  KitchenStationsController,
  LocationMenuController,
  ModifierGroupsController,
  ProductsController,
} from './menu.controllers';
import { ModifierGroupsService } from './modifier-groups.service';
import { ProductsService } from './products.service';
import { PublishedMenuService } from './published-menu.service';

/** Menu bounded context: catalog administration and the per-location published menu. */
@Module({
  controllers: [
    CategoriesController,
    KitchenStationsController,
    ModifierGroupsController,
    ProductsController,
    LocationMenuController,
  ],
  providers: [
    CategoriesService,
    KitchenStationsService,
    ModifierGroupsService,
    ProductsService,
    PublishedMenuService,
  ],
  exports: [PublishedMenuService],
})
export class MenuModule {}
