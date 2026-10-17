import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions, ZodValidationPipe } from '@pos/server';
import {
  type CashRegisterAdmin,
  type PaymentMethodAdmin,
  createCashRegisterSchema,
  createPaymentMethodSchema,
  idSchema,
  updateCashRegisterSchema,
  updatePaymentMethodSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PaymentSetupService } from './payment-setup.service';

const id = new ZodValidationPipe(idSchema);

/** Payment methods (restaurant-wide) and cash drawers (per location). Cloud only. */
@Controller()
export class PaymentSetupController {
  constructor(private readonly setup: PaymentSetupService) {}

  /** Every method including archived ones (the POS list, `GET …/payment-methods`, omits them). */
  @RequirePermissions(['settings.manage'])
  @Get('restaurants/:restaurantId/payment-methods/all')
  listMethods(@Param('restaurantId', id) restaurantId: string): Promise<PaymentMethodAdmin[]> {
    return this.setup.listMethods(restaurantId);
  }

  @RequirePermissions(['settings.manage'])
  @Post('restaurants/:restaurantId/payment-methods')
  createMethod(
    @Param('restaurantId', id) restaurantId: string,
    @Body(new ZodValidationPipe(createPaymentMethodSchema))
    body: z.output<typeof createPaymentMethodSchema>,
  ): Promise<PaymentMethodAdmin> {
    return this.setup.createMethod(restaurantId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Patch('restaurants/:restaurantId/payment-methods/:methodId')
  updateMethod(
    @Param('restaurantId', id) restaurantId: string,
    @Param('methodId', id) methodId: string,
    @Body(new ZodValidationPipe(updatePaymentMethodSchema))
    body: z.output<typeof updatePaymentMethodSchema>,
  ): Promise<PaymentMethodAdmin> {
    return this.setup.updateMethod(restaurantId, methodId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Post('restaurants/:restaurantId/payment-methods/:methodId/archive')
  @HttpCode(200)
  archiveMethod(
    @Param('restaurantId', id) restaurantId: string,
    @Param('methodId', id) methodId: string,
  ): Promise<PaymentMethodAdmin> {
    return this.setup.archiveMethod(restaurantId, methodId, true);
  }

  @RequirePermissions(['settings.manage'])
  @Post('restaurants/:restaurantId/payment-methods/:methodId/restore')
  @HttpCode(200)
  restoreMethod(
    @Param('restaurantId', id) restaurantId: string,
    @Param('methodId', id) methodId: string,
  ): Promise<PaymentMethodAdmin> {
    return this.setup.archiveMethod(restaurantId, methodId, false);
  }

  @RequirePermissions(['settings.manage'])
  @Get('locations/:locationId/cash-registers/all')
  listRegisters(@Param('locationId', id) locationId: string): Promise<CashRegisterAdmin[]> {
    return this.setup.listRegisters(locationId);
  }

  @RequirePermissions(['settings.manage'])
  @Post('locations/:locationId/cash-registers')
  createRegister(
    @Param('locationId', id) locationId: string,
    @Body(new ZodValidationPipe(createCashRegisterSchema))
    body: z.output<typeof createCashRegisterSchema>,
  ): Promise<CashRegisterAdmin> {
    return this.setup.createRegister(locationId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Patch('locations/:locationId/cash-registers/:registerId')
  updateRegister(
    @Param('locationId', id) locationId: string,
    @Param('registerId', id) registerId: string,
    @Body(new ZodValidationPipe(updateCashRegisterSchema))
    body: z.output<typeof updateCashRegisterSchema>,
  ): Promise<CashRegisterAdmin> {
    return this.setup.updateRegister(locationId, registerId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Post('locations/:locationId/cash-registers/:registerId/archive')
  @HttpCode(200)
  archiveRegister(
    @Param('locationId', id) locationId: string,
    @Param('registerId', id) registerId: string,
  ): Promise<CashRegisterAdmin> {
    return this.setup.archiveRegister(locationId, registerId, true);
  }

  @RequirePermissions(['settings.manage'])
  @Post('locations/:locationId/cash-registers/:registerId/restore')
  @HttpCode(200)
  restoreRegister(
    @Param('locationId', id) locationId: string,
    @Param('registerId', id) registerId: string,
  ): Promise<CashRegisterAdmin> {
    return this.setup.archiveRegister(locationId, registerId, false);
  }
}
