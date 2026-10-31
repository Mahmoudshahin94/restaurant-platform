import { Controller, Get, Param, Query } from '@nestjs/common';
import { ORGANIZATION_ROUTE_ROLES } from '@pos/domain';
import { ZodValidationPipe } from '@pos/server';
import {
  type BrandReport,
  type CategoryReport,
  type ChannelReport,
  type DailySalesReport,
  type LocationReport,
  type OrgDashboard,
  type OrganizationOverview,
  type PaymentReport,
  type ProductReport,
  idSchema,
  orgReportQuerySchema,
} from '@pos/validation';
import { OperationsReportsService } from '../reports/operations-reports.service';
import { SalesReportsService } from '../reports/sales-reports.service';
import { OrgDashboardService } from './org-dashboard.service';
import { OrgReportContextResolver, type OrgReportQueryInput } from './org-report-context';
import { OrgReportsService } from './org-reports.service';
import { CurrentOrganization, type RequestOrganization } from './organization.guard';
import { OrganizationRoute } from './organization-route';

const id = new ZodValidationPipe(idSchema);
const query = new ZodValidationPipe(orgReportQuerySchema);

/**
 * An organization's start page and reports (E1): its brands and branches, a dashboard, and the
 * brand reports over all (or some) of its brands. Open to every member; the handlers read in the
 * organization's scope.
 */
@Controller('organizations/:organizationId')
@OrganizationRoute(ORGANIZATION_ROUTE_ROLES.read)
export class OrgReportsController {
  constructor(
    private readonly dashboard: OrgDashboardService,
    private readonly context: OrgReportContextResolver,
    private readonly orgReports: OrgReportsService,
    private readonly sales: SalesReportsService,
    private readonly operations: OperationsReportsService,
  ) {}

  @Get()
  overview(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
  ): Promise<OrganizationOverview> {
    return this.dashboard.overview(org);
  }

  @Get('dashboard')
  dashboardOf(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
  ): Promise<OrgDashboard> {
    return this.dashboard.build(org);
  }

  @Get('reports/daily-sales')
  async dailySales(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
    @Query(query) q: OrgReportQueryInput,
  ): Promise<DailySalesReport> {
    return this.sales.dailySales(await this.context.resolve(org, q));
  }

  @Get('reports/brands')
  async brands(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
    @Query(query) q: OrgReportQueryInput,
  ): Promise<BrandReport> {
    return this.orgReports.brands(await this.context.resolve(org, q));
  }

  @Get('reports/locations')
  async locations(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
    @Query(query) q: OrgReportQueryInput,
  ): Promise<LocationReport> {
    return this.orgReports.locations(await this.context.resolve(org, q));
  }

  @Get('reports/channels')
  async channels(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
    @Query(query) q: OrgReportQueryInput,
  ): Promise<ChannelReport> {
    return this.sales.channels(await this.context.resolve(org, q));
  }

  @Get('reports/payments')
  async payments(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
    @Query(query) q: OrgReportQueryInput,
  ): Promise<PaymentReport> {
    return this.operations.payments(await this.context.resolve(org, q));
  }

  @Get('reports/products')
  async products(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
    @Query(query) q: OrgReportQueryInput,
  ): Promise<ProductReport> {
    return this.sales.products(await this.context.resolve(org, q));
  }

  @Get('reports/categories')
  async categories(
    @Param('organizationId', id) _id: string,
    @CurrentOrganization() org: RequestOrganization,
    @Query(query) q: OrgReportQueryInput,
  ): Promise<CategoryReport> {
    return this.sales.categories(await this.context.resolve(org, q));
  }
}
