import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  type Discount,
  type Tax,
  createDiscountSchema,
  createTaxSchema,
  idSchema,
  listQuerySchema,
  updateDiscountSchema,
  updateTaxSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { ManagedInCloud } from '../../common/auth/managed-in-cloud';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { PricingConfigService } from './pricing-config.service';

const id = new ZodValidationPipe(idSchema);
const listQuery = new ZodValidationPipe(listQuerySchema);
type ListQuery = z.output<typeof listQuerySchema>;

@ManagedInCloud()
@Controller('tenants/:tenantId/taxes')
export class TaxesController {
  constructor(private readonly config: PricingConfigService) {}

  @RequirePermissions(['products.view'], { scope: 'any-location' })
  @Get()
  list(@Param('tenantId', id) tenantId: string, @Query(listQuery) q: ListQuery): Promise<Tax[]> {
    return this.config.listTaxes(tenantId, q.includeArchived);
  }

  @RequirePermissions(['settings.manage'])
  @Post()
  create(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(createTaxSchema)) body: z.output<typeof createTaxSchema>,
  ): Promise<Tax> {
    return this.config.createTax(tenantId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Patch(':taxId')
  update(
    @Param('tenantId', id) tenantId: string,
    @Param('taxId', id) taxId: string,
    @Body(new ZodValidationPipe(updateTaxSchema)) body: z.output<typeof updateTaxSchema>,
  ): Promise<Tax> {
    return this.config.updateTax(tenantId, taxId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Post(':taxId/archive')
  @HttpCode(200)
  archive(
    @Param('tenantId', id) tenantId: string,
    @Param('taxId', id) taxId: string,
  ): Promise<Tax> {
    return this.config.setTaxArchived(tenantId, taxId, true);
  }

  @RequirePermissions(['settings.manage'])
  @Post(':taxId/restore')
  @HttpCode(200)
  restore(
    @Param('tenantId', id) tenantId: string,
    @Param('taxId', id) taxId: string,
  ): Promise<Tax> {
    return this.config.setTaxArchived(tenantId, taxId, false);
  }
}

@ManagedInCloud()
@Controller('tenants/:tenantId/discounts')
export class DiscountsController {
  constructor(private readonly config: PricingConfigService) {}

  /** Any member may list discounts (the POS shows them); applying one needs orders.discount. */
  @RequirePermissions([], { scope: 'any-location' })
  @Get()
  list(
    @Param('tenantId', id) tenantId: string,
    @Query(listQuery) q: ListQuery,
  ): Promise<Discount[]> {
    return this.config.listDiscounts(tenantId, q.includeArchived);
  }

  @RequirePermissions(['settings.manage'])
  @Post()
  create(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(createDiscountSchema)) body: z.output<typeof createDiscountSchema>,
  ): Promise<Discount> {
    return this.config.createDiscount(tenantId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Patch(':discountId')
  update(
    @Param('tenantId', id) tenantId: string,
    @Param('discountId', id) discountId: string,
    @Body(new ZodValidationPipe(updateDiscountSchema)) body: z.output<typeof updateDiscountSchema>,
  ): Promise<Discount> {
    return this.config.updateDiscount(tenantId, discountId, body);
  }

  @RequirePermissions(['settings.manage'])
  @Post(':discountId/archive')
  @HttpCode(200)
  archive(
    @Param('tenantId', id) tenantId: string,
    @Param('discountId', id) discountId: string,
  ): Promise<Discount> {
    return this.config.setDiscountArchived(tenantId, discountId, true);
  }

  @RequirePermissions(['settings.manage'])
  @Post(':discountId/restore')
  @HttpCode(200)
  restore(
    @Param('tenantId', id) tenantId: string,
    @Param('discountId', id) discountId: string,
  ): Promise<Discount> {
    return this.config.setDiscountArchived(tenantId, discountId, false);
  }
}
