import { Global, Module } from '@nestjs/common';
import { ACCOUNT_DIRECTORY } from '@pos/server';
import { DevicesModule } from '../devices/devices.module';
import { CloudReportsModule } from '../reports/reports.module';
import { CloudAccountDirectory } from './cloud-account-directory';
import { MembersController } from './members.controller';
import { OrgDashboardService } from './org-dashboard.service';
import { OrgReportContextResolver } from './org-report-context';
import { OrgReportsController } from './org-reports.controller';
import { OrgReportsService } from './org-reports.service';
import { OrganizationGuard, OrganizationScopeInterceptor } from './organization.guard';
import { OrganizationService } from './organization.service';

/**
 * Organizations (E1): the members' pages, the dashboard and reports, and the service that owns linked users. Global because
 * it also provides the account directory to the shared auth module (an account's brands across
 * every tenant, and its organizations, for sign-in and the switcher).
 */
@Global()
@Module({
  imports: [DevicesModule, CloudReportsModule],
  controllers: [MembersController, OrgReportsController],
  providers: [
    OrgDashboardService,
    OrgReportContextResolver,
    OrgReportsService,
    { provide: ACCOUNT_DIRECTORY, useClass: CloudAccountDirectory },
    OrganizationService,
    OrganizationGuard,
    OrganizationScopeInterceptor,
  ],
  exports: [ACCOUNT_DIRECTORY, OrganizationService],
})
export class OrganizationsModule {}
