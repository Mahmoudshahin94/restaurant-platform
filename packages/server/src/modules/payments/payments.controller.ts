import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  type PaymentMethod,
  createPaymentSchema,
  idSchema,
  refundPaymentSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { type PaymentOutcome, PaymentsService } from './payments.service';

const id = new ZodValidationPipe(idSchema);

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermissions([], { scope: 'any-location' })
  @Get('tenants/:tenantId/payment-methods')
  methods(@Param('tenantId', id) tenantId: string): Promise<PaymentMethod[]> {
    return this.payments.listMethods(tenantId);
  }

  /** Idempotent on the payment id: a retry returns the recorded payment, never a second charge. */
  @RequirePermissions(['payments.create'])
  @Post('locations/:locationId/orders/:orderId/payments')
  @HttpCode(200)
  charge(
    @Param('locationId', id) locationId: string,
    @Param('orderId', id) orderId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(createPaymentSchema)) body: z.output<typeof createPaymentSchema>,
  ): Promise<PaymentOutcome> {
    return this.payments.charge(principal, locationId, orderId, body);
  }

  @RequirePermissions(['payments.refund'])
  @Post('locations/:locationId/orders/:orderId/payments/:paymentId/refunds')
  @HttpCode(200)
  refund(
    @Param('locationId', id) locationId: string,
    @Param('orderId', id) orderId: string,
    @Param('paymentId', id) paymentId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(refundPaymentSchema)) body: z.output<typeof refundPaymentSchema>,
  ): Promise<PaymentOutcome> {
    return this.payments.refund(principal, locationId, orderId, paymentId, body);
  }
}
