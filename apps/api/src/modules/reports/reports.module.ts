import { Module } from '@nestjs/common';
import { OperationsReportsService } from './operations-reports.service';
import { ReportContextResolver } from './report-context';
import { ReportsController } from './reports.controller';
import { SalesReportsService } from './sales-reports.service';

/**
 * Cloud-only reports (Phase 9, ADR 0015): SQL over the `report_*` PostgreSQL views. Location hubs
 * keep only the shift-close daily summary of `@pos/server`.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportContextResolver, SalesReportsService, OperationsReportsService],
  // The organization's reports (E1) run the same SQL over several brands.
  exports: [SalesReportsService, OperationsReportsService],
})
export class CloudReportsModule {}
