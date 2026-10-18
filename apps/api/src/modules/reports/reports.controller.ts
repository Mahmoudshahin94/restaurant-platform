import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
  ZodValidationPipe,
} from '@pos/server';
import {
  type CategoryReport,
  type ChannelReport,
  type DailySalesReport,
  type DiscountReport,
  type PaymentReport,
  type PrepTimeReport,
  type ProductReport,
  type ShiftReport,
  type TaxReport,
  idSchema,
  reportQuerySchema,
} from '@pos/validation';
import { OperationsReportsService } from './operations-reports.service';
import { ReportContextResolver, type ReportQueryInput } from './report-context';
import { SalesReportsService } from './sales-reports.service';

const id = new ZodValidationPipe(idSchema);
const query = new ZodValidationPipe(reportQuerySchema);

/**
 * Reports (Phase 9, ADR 0015). Open to whoever holds `reports.view` somewhere; each report covers
 * only the locations where they hold it (`locationIds` narrows that, 404 for others).
 */
@RequirePermissions(['reports.view'], { scope: 'any-location' })
@Controller('restaurants/:restaurantId/reports')
export class ReportsController {
  constructor(
    private readonly context: ReportContextResolver,
    private readonly sales: SalesReportsService,
    private readonly operations: OperationsReportsService,
  ) {}

  @Get('daily-sales')
  async dailySales(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<DailySalesReport> {
    return this.sales.dailySales(await this.context.resolve(principal, q));
  }

  @Get('channels')
  async channels(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<ChannelReport> {
    return this.sales.channels(await this.context.resolve(principal, q));
  }

  @Get('payments')
  async payments(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<PaymentReport> {
    return this.operations.payments(await this.context.resolve(principal, q));
  }

  @Get('products')
  async products(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<ProductReport> {
    return this.sales.products(await this.context.resolve(principal, q));
  }

  @Get('categories')
  async categories(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<CategoryReport> {
    return this.sales.categories(await this.context.resolve(principal, q));
  }

  @Get('taxes')
  async taxes(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<TaxReport> {
    return this.sales.taxes(await this.context.resolve(principal, q));
  }

  @Get('discounts')
  async discounts(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<DiscountReport> {
    return this.sales.discounts(await this.context.resolve(principal, q));
  }

  @Get('shifts')
  async shifts(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<ShiftReport> {
    return this.operations.shifts(await this.context.resolve(principal, q));
  }

  @Get('prep-times')
  async prepTimes(
    @Param('restaurantId', id) _rid: string,
    @CurrentPrincipal() principal: Principal,
    @Query(query) q: ReportQueryInput,
  ): Promise<PrepTimeReport> {
    return this.operations.prepTimes(await this.context.resolve(principal, q));
  }
}
