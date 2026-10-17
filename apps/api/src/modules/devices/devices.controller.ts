import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  type AdminDevice,
  type Device,
  type PairedDevice,
  idSchema,
  pairDeviceSchema,
} from '@pos/validation';
import { RequirePermissions, ZodValidationPipe } from '@pos/server';
import type { z } from 'zod';
import { DevicesService } from './devices.service';

const id = new ZodValidationPipe(idSchema);

@Controller('locations/:locationId/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @RequirePermissions(['devices.manage'])
  @Get()
  list(@Param('locationId', id) locationId: string): Promise<AdminDevice[]> {
    return this.devices.list(locationId);
  }

  /** Pairs a location hub: returns its credential once. */
  @RequirePermissions(['devices.manage'])
  @Post()
  pair(
    @Param('locationId', id) locationId: string,
    @Body(new ZodValidationPipe(pairDeviceSchema)) body: z.output<typeof pairDeviceSchema>,
  ): Promise<PairedDevice> {
    return this.devices.pair(locationId, body);
  }

  @RequirePermissions(['devices.manage'])
  @Post(':deviceId/disable')
  @HttpCode(200)
  disable(
    @Param('locationId', id) locationId: string,
    @Param('deviceId', id) deviceId: string,
  ): Promise<Device> {
    return this.devices.disable(locationId, deviceId);
  }
}
