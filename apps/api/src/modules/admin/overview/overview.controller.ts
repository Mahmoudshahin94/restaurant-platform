import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
  ZodValidationPipe,
} from '@pos/server';
import {
  type AuditLogEntry,
  type CustomerDetail,
  type CustomerSummary,
  type Dashboard,
  type OrderSummary,
  type Paginated,
  type PaymentListItem,
  adminRefundSchema,
  auditLogQuerySchema,
  customerQuerySchema,
  idSchema,
  orderSearchQuerySchema,
  paymentSearchQuerySchema,
} from '@pos/validation';
import { z } from 'zod';
import { AuditLogsService } from './audit-logs.service';
import { DashboardService } from './dashboard.service';
import { RefundsService } from './refunds.service';
import { SearchService } from './search.service';

const id = new ZodValidationPipe(idSchema);
const customerKey = new ZodValidationPipe(z.string().regex(/^[a-f0-9]{64}$/));

/**
 * Tenant-wide views for the admin portal. `any-location` routes are open to whoever holds the
 * permission at some location and filter their results to those locations.
 */
@Controller()
export class OverviewController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly search: SearchService,
    private readonly refunds: RefundsService,
    private readonly audit: AuditLogsService,
  ) {}

  @RequirePermissions(['orders.view'], { scope: 'any-location' })
  @Get('tenants/:tenantId/dashboard')
  getDashboard(
    @Param('tenantId', id) _tenantId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<Dashboard> {
    return this.dashboard.build(principal);
  }

  @RequirePermissions(['orders.view'], { scope: 'any-location' })
  @Get('tenants/:tenantId/orders')
  orders(
    @Param('tenantId', id) _tenantId: string,
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(orderSearchQuerySchema))
    query: z.output<typeof orderSearchQuerySchema>,
  ): Promise<Paginated<OrderSummary>> {
    return this.search.orders(principal, query);
  }

  @RequirePermissions(['customers.view'], { scope: 'any-location' })
  @Get('tenants/:tenantId/customers')
  customers(
    @Param('tenantId', id) _tenantId: string,
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(customerQuerySchema)) query: z.output<typeof customerQuerySchema>,
  ): Promise<Paginated<CustomerSummary>> {
    return this.search.customers(principal, query);
  }

  @RequirePermissions(['customers.view'], { scope: 'any-location' })
  @Get('tenants/:tenantId/customers/:customerKey')
  customer(
    @Param('tenantId', id) _tenantId: string,
    @Param('customerKey', customerKey) key: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<CustomerDetail> {
    return this.search.customer(principal, key);
  }

  @RequirePermissions(['payments.view'], { scope: 'any-location' })
  @Get('tenants/:tenantId/payments')
  payments(
    @Param('tenantId', id) _tenantId: string,
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(paymentSearchQuerySchema))
    query: z.output<typeof paymentSearchQuerySchema>,
  ): Promise<Paginated<PaymentListItem>> {
    return this.search.payments(principal, query);
  }

  /** Refunds an online card charge (see RefundsService). Idempotent by `body.id`. */
  @RequirePermissions(['payments.refund'])
  @Post('locations/:locationId/payments/:paymentId/refunds')
  refund(
    @Param('locationId', id) locationId: string,
    @Param('paymentId', id) paymentId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(adminRefundSchema)) body: z.output<typeof adminRefundSchema>,
  ): Promise<PaymentListItem> {
    return this.refunds.refund(principal, locationId, paymentId, body);
  }

  @RequirePermissions(['audit.view'], { scope: 'any-location' })
  @Get('tenants/:tenantId/audit-logs')
  auditLogs(
    @Param('tenantId', id) _tenantId: string,
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: z.output<typeof auditLogQuerySchema>,
  ): Promise<Paginated<AuditLogEntry>> {
    return this.audit.search(principal, query);
  }
}
