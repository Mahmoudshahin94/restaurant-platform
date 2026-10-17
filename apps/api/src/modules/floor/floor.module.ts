import { Module } from '@nestjs/common';
import { FloorController } from './floor.controller';
import { FloorService } from './floor.service';

/** Floor plan: table sections, tables and their occupancy. */
@Module({
  controllers: [FloorController],
  providers: [FloorService],
})
export class FloorModule {}
