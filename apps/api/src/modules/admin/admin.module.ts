import { Module } from '@nestjs/common';
import { OnlineOrderingModule, PaymentsModule } from '@pos/server';
import { DevicesModule } from '../devices/devices.module';
import { AuditLogsService } from './overview/audit-logs.service';
import { DashboardService } from './overview/dashboard.service';
import { OverviewController } from './overview/overview.controller';
import { RefundsService } from './overview/refunds.service';
import { SearchService } from './overview/search.service';
import { PaymentProvidersController } from './payment-setup/payment-providers.controller';
import { PaymentProvidersService } from './payment-setup/payment-providers.service';
import { PaymentSetupController } from './payment-setup/payment-setup.controller';
import { PaymentSetupService } from './payment-setup/payment-setup.service';
import { EmployeesService } from './staff/employees.service';
import { RolesService } from './staff/roles.service';
import { StaffController } from './staff/staff.controller';
import { UsersService } from './staff/users.service';

/**
 * The admin portal's cloud-only API (Phase 8): staff and roles, payment setup and payment
 * providers (ADR 0024), the dashboard,
 * searches across locations, online refunds and the audit log. Location hubs receive the
 * configuration through the change feed and never serve these routes.
 */
@Module({
  imports: [DevicesModule, OnlineOrderingModule, PaymentsModule],
  controllers: [
    StaffController,
    PaymentSetupController,
    PaymentProvidersController,
    OverviewController,
  ],
  providers: [
    UsersService,
    RolesService,
    EmployeesService,
    PaymentSetupService,
    PaymentProvidersService,
    DashboardService,
    SearchService,
    RefundsService,
    AuditLogsService,
  ],
})
export class AdminModule {}
