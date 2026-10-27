import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions, ZodValidationPipe } from '@pos/server';
import {
  type PaymentProviderAccount,
  type PaymentProvidersOverview,
  createPaymentProviderAccountSchema,
  idSchema,
  updatePaymentProviderAccountSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PaymentProvidersService } from './payment-providers.service';

const id = new ZodValidationPipe(idSchema);

/**
 * Payment provider accounts (ADR 0024): tenant-wide `settings.manage`, so only the business's
 * administrators (not a location's) see and change them. Secrets go in, never out. Cloud only.
 */
@Controller()
export class PaymentProvidersController {
  constructor(private readonly providers: PaymentProvidersService) {}

  @RequirePermissions(['settings.manage'])
  @Get('tenants/:tenantId/payment-providers')
  overview(@Param('tenantId', id) tenantId: string): Promise<PaymentProvidersOverview> {
    return this.providers.overview(tenantId);
  }

  @RequirePermissions(['settings.manage'])
  @Post('tenants/:tenantId/payment-providers')
  create(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(createPaymentProviderAccountSchema))
    body: z.output<typeof createPaymentProviderAccountSchema>,
  ): Promise<PaymentProviderAccount> {
    return this.providers.create(tenantId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Patch('tenants/:tenantId/payment-providers/:accountId')
  update(
    @Param('tenantId', id) tenantId: string,
    @Param('accountId', id) accountId: string,
    @Body(new ZodValidationPipe(updatePaymentProviderAccountSchema))
    body: z.output<typeof updatePaymentProviderAccountSchema>,
  ): Promise<PaymentProviderAccount> {
    return this.providers.update(tenantId, accountId, body);
  }
}
