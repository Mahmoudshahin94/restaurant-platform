import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentPlatformUser,
  type PlatformActor,
  RequirePlatformPermissions,
  ZodValidationPipe,
} from '@pos/server';
import {
  type AdminDevice,
  type AuditLogEntry,
  type DeviceVersions,
  type HealthBoard,
  type Location,
  type Paginated,
  type PaymentProvidersOverview,
  type PlatformAuditEntry,
  type PlatformErrorEventDto,
  type PlatformModule,
  type PlatformTenantDetail,
  type PlatformTenantSummary,
  type PlatformTenantUser,
  type ProvisionedTenantDto,
  type ReleaseDto,
  type ReleasesOverview,
  type SupportExecution,
  type SupportFindResult,
  type SupportOperationDto,
  type SupportPreview,
  type TenantBrandingDto,
  type TenantDomainDto,
  type TenantHealth,
  type TenantRollout,
  auditLogQuerySchema,
  changeTenantStatusSchema,
  deviceVersionsQuerySchema,
  idSchema,
  platformAuditQuerySchema,
  platformErrorsQuerySchema,
  platformTenantsQuerySchema,
  provisionTenantSchema,
  publishReleaseSchema,
  setEntitlementsSchema,
  setTenantRolloutSchema,
  supportExecuteSchema,
  supportFindQuerySchema,
  supportRequestSchema,
  updateReleaseSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PlatformGuard } from './auth/platform.guard';
import { PlatformErrorEventsService } from './health/platform-error-events.service';
import { PlatformHealthService } from './health/platform-health.service';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformDirectoryService } from './platform-directory.service';
import { PlatformReleasesService } from './releases/platform-releases.service';
import { SupportService } from './support/support.service';
import { PlatformTenantsService } from './tenants/platform-tenants.service';

const id = new ZodValidationPipe(idSchema);

/**
 * The platform admin's tenants (ADR 0025): MADAR's operators only (`PlatformGuard`, platform
 * tokens). Routes naming `:tenantId` are scoped to that tenant by the guard.
 */
@Controller('platform/tenants')
@UseGuards(PlatformGuard)
export class PlatformTenantsController {
  constructor(
    private readonly directory: PlatformDirectoryService,
    private readonly tenants: PlatformTenantsService,
    private readonly health: PlatformHealthService,
  ) {}

  @RequirePlatformPermissions(['tenants.view'])
  @Get()
  list(
    @Query(new ZodValidationPipe(platformTenantsQuerySchema))
    query: z.output<typeof platformTenantsQuerySchema>,
  ): Promise<Paginated<PlatformTenantSummary>> {
    return this.directory.listTenants(query);
  }

  /** The owner's temporary password is in this answer only. */
  @RequirePlatformPermissions(['tenants.provision'])
  @Post()
  provision(
    @Body(new ZodValidationPipe(provisionTenantSchema))
    body: z.output<typeof provisionTenantSchema>,
  ): Promise<ProvisionedTenantDto> {
    return this.tenants.provision(body);
  }

  @RequirePlatformPermissions(['tenants.view'])
  @Get(':tenantId')
  detail(@Param('tenantId', id) tenantId: string): Promise<PlatformTenantDetail> {
    return this.tenants.detail(tenantId);
  }

  @RequirePlatformPermissions(['tenants.status'])
  @Post(':tenantId/status')
  @HttpCode(200)
  setStatus(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(changeTenantStatusSchema))
    body: z.output<typeof changeTenantStatusSchema>,
  ): Promise<PlatformTenantDetail> {
    return this.tenants.setStatus(tenantId, body);
  }

  @RequirePlatformPermissions(['tenants.view'])
  @Get(':tenantId/locations')
  locations(@Param('tenantId', id) tenantId: string): Promise<Location[]> {
    return this.tenants.locations(tenantId);
  }

  @RequirePlatformPermissions(['tenants.view'])
  @Get(':tenantId/users')
  users(@Param('tenantId', id) tenantId: string): Promise<PlatformTenantUser[]> {
    return this.tenants.users(tenantId);
  }

  @RequirePlatformPermissions(['tenants.view'])
  @Get(':tenantId/devices')
  devices(@Param('tenantId', id) tenantId: string): Promise<AdminDevice[]> {
    return this.tenants.devices(tenantId);
  }

  @RequirePlatformPermissions(['tenants.view'])
  @Get(':tenantId/modules')
  modules(@Param('tenantId', id) tenantId: string): Promise<PlatformModule[]> {
    return this.tenants.modules(tenantId);
  }

  @RequirePlatformPermissions(['tenants.configure'])
  @Put(':tenantId/entitlements')
  setEntitlements(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(setEntitlementsSchema))
    body: z.output<typeof setEntitlementsSchema>,
  ): Promise<PlatformModule[]> {
    return this.tenants.setEntitlements(tenantId, body);
  }

  @RequirePlatformPermissions(['tenants.view'])
  @Get(':tenantId/branding')
  branding(@Param('tenantId', id) tenantId: string): Promise<TenantBrandingDto> {
    return this.tenants.branding(tenantId);
  }

  @RequirePlatformPermissions(['tenants.view'])
  @Get(':tenantId/domains')
  domains(@Param('tenantId', id) tenantId: string): Promise<TenantDomainDto[]> {
    return this.tenants.domainList(tenantId);
  }

  @RequirePlatformPermissions(['tenants.configure'])
  @Post(':tenantId/domains/:domainId/verify')
  @HttpCode(200)
  verifyDomain(
    @Param('tenantId', id) tenantId: string,
    @Param('domainId', id) domainId: string,
  ): Promise<TenantDomainDto> {
    return this.tenants.verifyDomain(tenantId, domainId);
  }

  @RequirePlatformPermissions(['tenants.payments.view'])
  @Get(':tenantId/payment-accounts')
  paymentAccounts(@Param('tenantId', id) tenantId: string): Promise<PaymentProvidersOverview> {
    return this.tenants.paymentAccounts(tenantId);
  }

  @RequirePlatformPermissions(['health.view'])
  @Get(':tenantId/health')
  tenantHealth(@Param('tenantId', id) tenantId: string): Promise<TenantHealth> {
    return this.health.tenant(tenantId);
  }

  @RequirePlatformPermissions(['audit.view'])
  @Get(':tenantId/audit-logs')
  auditLogs(
    @Param('tenantId', id) tenantId: string,
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: z.output<typeof auditLogQuerySchema>,
  ): Promise<Paginated<AuditLogEntry>> {
    return this.tenants.auditLogs(tenantId, query);
  }
}

/** The health board, recent server errors and the platform's own audit log (ADR 0025). */
@Controller('platform')
@UseGuards(PlatformGuard)
export class PlatformOverviewController {
  constructor(
    private readonly health: PlatformHealthService,
    private readonly errors: PlatformErrorEventsService,
    private readonly audit: PlatformAuditService,
  ) {}

  @RequirePlatformPermissions(['health.view'])
  @Get('health')
  board(): Promise<HealthBoard> {
    return this.health.board();
  }

  @RequirePlatformPermissions(['health.view'])
  @Get('errors')
  recentErrors(
    @Query(new ZodValidationPipe(platformErrorsQuerySchema))
    query: z.output<typeof platformErrorsQuerySchema>,
  ): Promise<PlatformErrorEventDto[]> {
    return this.errors.recent(query);
  }

  @RequirePlatformPermissions(['audit.view'])
  @Get('audit-logs')
  auditLogs(
    @Query(new ZodValidationPipe(platformAuditQuerySchema))
    query: z.output<typeof platformAuditQuerySchema>,
  ): Promise<Paginated<PlatformAuditEntry>> {
    return this.audit.search(query);
  }
}

/**
 * The support tools (ADR 0025): finding needs `support.find`; previewing and executing a repair
 * need `support.repair` and a role the repair's catalog entry allows.
 */
@Controller('platform')
@UseGuards(PlatformGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @RequirePlatformPermissions(['support.find'])
  @Get('support/operations')
  operations(): SupportOperationDto[] {
    return this.support.operations();
  }

  @RequirePlatformPermissions(['support.find'])
  @Get('tenants/:tenantId/support/find')
  find(
    @Param('tenantId', id) tenantId: string,
    @Query(new ZodValidationPipe(supportFindQuerySchema))
    query: z.output<typeof supportFindQuerySchema>,
  ): Promise<SupportFindResult> {
    return this.support.find(tenantId, query);
  }

  @RequirePlatformPermissions(['support.repair'])
  @Post('tenants/:tenantId/support/preview')
  @HttpCode(200)
  preview(
    @Param('tenantId', id) tenantId: string,
    @CurrentPlatformUser() actor: PlatformActor,
    @Body(new ZodValidationPipe(supportRequestSchema))
    body: z.output<typeof supportRequestSchema>,
  ): Promise<SupportPreview> {
    return this.support.preview({ tenantId, actor }, body);
  }

  @RequirePlatformPermissions(['support.repair'])
  @Post('tenants/:tenantId/support/execute')
  @HttpCode(200)
  execute(
    @Param('tenantId', id) tenantId: string,
    @CurrentPlatformUser() actor: PlatformActor,
    @Body(new ZodValidationPipe(supportExecuteSchema))
    body: z.output<typeof supportExecuteSchema>,
  ): Promise<SupportExecution> {
    return this.support.execute({ tenantId, actor }, body);
  }
}

/**
 * Releases and rollout (ADR 0026): the releases MADAR published and the minimum versions they
 * declare (`releases.publish`), each tenant's channel or pinned version (`releases.rollout`), and
 * the versions every device reports (`releases.view`).
 */
@Controller('platform')
@UseGuards(PlatformGuard)
export class PlatformReleasesController {
  constructor(private readonly releases: PlatformReleasesService) {}

  @RequirePlatformPermissions(['releases.view'])
  @Get('releases')
  overview(): Promise<ReleasesOverview> {
    return this.releases.overview();
  }

  @RequirePlatformPermissions(['releases.publish'])
  @Post('releases')
  publish(
    @Body(new ZodValidationPipe(publishReleaseSchema))
    body: z.output<typeof publishReleaseSchema>,
  ): Promise<ReleaseDto> {
    return this.releases.publish(body);
  }

  @RequirePlatformPermissions(['releases.publish'])
  @Patch('releases/:releaseId')
  update(
    @Param('releaseId', id) releaseId: string,
    @Body(new ZodValidationPipe(updateReleaseSchema)) body: z.output<typeof updateReleaseSchema>,
  ): Promise<ReleaseDto> {
    return this.releases.update(releaseId, body);
  }

  @RequirePlatformPermissions(['releases.view'])
  @Get('device-versions')
  deviceVersions(
    @Query(new ZodValidationPipe(deviceVersionsQuerySchema))
    query: z.output<typeof deviceVersionsQuerySchema>,
  ): Promise<DeviceVersions> {
    return this.releases.deviceVersions(query);
  }

  @RequirePlatformPermissions(['releases.view'])
  @Get('tenants/:tenantId/release-channel')
  rollout(@Param('tenantId', id) tenantId: string): Promise<TenantRollout> {
    return this.releases.rollout(tenantId);
  }

  @RequirePlatformPermissions(['releases.rollout'])
  @Put('tenants/:tenantId/release-channel')
  setRollout(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(setTenantRolloutSchema))
    body: z.output<typeof setTenantRolloutSchema>,
  ): Promise<TenantRollout> {
    return this.releases.setRollout(tenantId, body);
  }
}
