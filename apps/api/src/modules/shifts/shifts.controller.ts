import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type CashRegister,
  type Shift,
  cashMovementSchema,
  closeShiftSchema,
  idSchema,
  listShiftsQuerySchema,
  openShiftSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ShiftsService } from './shifts.service';

const id = new ZodValidationPipe(idSchema);

@Controller('locations/:locationId')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @RequirePermissions(['shifts.manage'])
  @Get('cash-registers')
  registers(@Param('locationId', id) locationId: string): Promise<CashRegister[]> {
    return this.shifts.registers(locationId);
  }

  @RequirePermissions(['shifts.manage'])
  @Get('shifts')
  list(
    @Param('locationId', id) locationId: string,
    @Query(new ZodValidationPipe(listShiftsQuerySchema)) q: z.output<typeof listShiftsQuerySchema>,
  ): Promise<Shift[]> {
    return this.shifts.list(locationId, q.status, q.limit);
  }

  @RequirePermissions(['shifts.manage'])
  @Get('shifts/:shiftId')
  get(
    @Param('locationId', id) locationId: string,
    @Param('shiftId', id) shiftId: string,
  ): Promise<Shift> {
    return this.shifts.get(locationId, shiftId);
  }

  @RequirePermissions(['shifts.manage'])
  @Post('shifts')
  @HttpCode(200)
  open(
    @Param('locationId', id) locationId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(openShiftSchema)) body: z.output<typeof openShiftSchema>,
  ): Promise<Shift> {
    return this.shifts.open(principal, locationId, body);
  }

  @RequirePermissions(['cash.manage'])
  @Post('shifts/:shiftId/cash-movements')
  @HttpCode(200)
  cashMovement(
    @Param('locationId', id) locationId: string,
    @Param('shiftId', id) shiftId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(cashMovementSchema)) body: z.output<typeof cashMovementSchema>,
  ): Promise<Shift> {
    return this.shifts.recordCashMovement(principal, locationId, shiftId, body);
  }

  @RequirePermissions(['shifts.manage'])
  @Post('shifts/:shiftId/close')
  @HttpCode(200)
  close(
    @Param('locationId', id) locationId: string,
    @Param('shiftId', id) shiftId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(closeShiftSchema)) body: z.output<typeof closeShiftSchema>,
  ): Promise<Shift> {
    return this.shifts.close(principal, locationId, shiftId, body);
  }
}
