import { Module } from '@nestjs/common';
import { DeviceGuard } from './device.guard';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, DeviceGuard],
  exports: [DeviceGuard],
})
export class DevicesModule {}
