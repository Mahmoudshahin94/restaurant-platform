import { Module } from '@nestjs/common';
import { KitchenDispatchService } from './kitchen-dispatch.service';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';

@Module({
  controllers: [KitchenController],
  providers: [KitchenService, KitchenDispatchService],
  exports: [KitchenDispatchService],
})
export class KitchenModule {}
