import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/** One Order domain for every channel; channel-specific entry points reuse OrdersService. */
@Module({
  imports: [MenuModule, KitchenModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
