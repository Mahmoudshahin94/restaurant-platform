import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CurrentPrincipal,
  type Principal,
  RequirePermissions,
  ZodValidationPipe,
} from '@pos/server';
import {
  type AdminSyncIssue,
  type LocationSyncStatus,
  type SyncIssueDetail,
  idSchema,
  resolveSyncIssueSchema,
  syncIssuesQuerySchema,
} from '@pos/validation';
import type { z } from 'zod';
import { SyncAdminService } from './sync-admin.service';

const id = new ZodValidationPipe(idSchema);

/** A location's hub link and the operations the cloud refused from it (ADR 0014). */
@Controller('locations/:locationId/sync')
export class SyncAdminController {
  constructor(private readonly sync: SyncAdminService) {}

  @RequirePermissions(['sync.view'])
  @Get('status')
  status(@Param('locationId', id) locationId: string): Promise<LocationSyncStatus> {
    return this.sync.status(locationId);
  }

  /** Refused operations, newest first (`state=open` by default; up to 200). */
  @RequirePermissions(['sync.view'])
  @Get('issues')
  issues(
    @Param('locationId', id) locationId: string,
    @Query(new ZodValidationPipe(syncIssuesQuerySchema))
    query: z.output<typeof syncIssuesQuerySchema>,
  ): Promise<AdminSyncIssue[]> {
    return this.sync.issues(locationId, query);
  }

  /** Both versions side by side, and what can be done about it. */
  @RequirePermissions(['sync.view'])
  @Get('issues/:operationId')
  detail(
    @Param('locationId', id) locationId: string,
    @Param('operationId', id) operationId: string,
  ): Promise<SyncIssueDetail> {
    return this.sync.detail(locationId, operationId);
  }

  @RequirePermissions(['sync.view', 'sync.resolve'])
  @Post('issues/:operationId/resolve')
  @HttpCode(200)
  resolve(
    @Param('locationId', id) locationId: string,
    @Param('operationId', id) operationId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(resolveSyncIssueSchema))
    body: z.output<typeof resolveSyncIssueSchema>,
  ): Promise<SyncIssueDetail> {
    return this.sync.resolve(principal, locationId, operationId, body);
  }
}
