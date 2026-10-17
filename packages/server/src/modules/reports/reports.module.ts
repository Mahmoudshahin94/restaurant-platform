import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { type DailySummary, idSchema } from '@pos/validation';
import { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { DailySummaryService } from './daily-summary.service';

const dailyQuery = z.object({ businessDate: z.iso.date().optional() });

@Controller('locations/:locationId/reports')
export class ReportsController {
  constructor(private readonly daily: DailySummaryService) {}

  /** Shift staff see the day's summary when closing; full reports need reports.view (Phase 9). */
  @RequirePermissions(['shifts.manage'])
  @Get('daily-summary')
  dailySummary(
    @Param('locationId', new ZodValidationPipe(idSchema)) locationId: string,
    @Query(new ZodValidationPipe(dailyQuery)) q: z.output<typeof dailyQuery>,
  ): Promise<DailySummary> {
    return this.daily.get(locationId, q.businessDate);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [DailySummaryService],
})
export class ReportsModule {}
