import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
  type LinkedMemberDto,
  type MemberDto,
  type Paginated,
  type PlatformOrganizationAttached,
  type PlatformOrganizationDetail,
  type PlatformOrganizationSummary,
  addMemberSchema,
  attachOrganizationTenantSchema,
  changeMemberRoleSchema,
  createOrganizationSchema,
  idSchema,
  platformOrganizationsQuerySchema,
  updateOrganizationSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { PlatformGuard } from '../auth/platform.guard';
import {
  type PlatformOrganizationActor,
  PlatformOrganizationsService,
} from './platform-organizations.service';

const id = new ZodValidationPipe(idSchema);

const actorOf = (operator: PlatformActor): PlatformOrganizationActor => ({
  kind: 'platform',
  platformUserId: operator.id,
});

/**
 * The platform admin's organizations (E1): MADAR's operators only (`PlatformGuard`, platform
 * tokens). Reading needs `organizations.view`, every change `organizations.manage`; each change
 * is in the platform's audit log (`organization.*`) and, for brands' users, in the brand's.
 */
@Controller('platform/organizations')
@UseGuards(PlatformGuard)
export class PlatformOrganizationsController {
  constructor(private readonly organizations: PlatformOrganizationsService) {}

  @RequirePlatformPermissions(['organizations.view'])
  @Get()
  list(
    @Query(new ZodValidationPipe(platformOrganizationsQuerySchema))
    query: z.output<typeof platformOrganizationsQuerySchema>,
  ): Promise<Paginated<PlatformOrganizationSummary>> {
    return this.organizations.list(query);
  }

  @RequirePlatformPermissions(['organizations.manage'])
  @Post()
  create(
    @CurrentPlatformUser() operator: PlatformActor,
    @Body(new ZodValidationPipe(createOrganizationSchema))
    body: z.output<typeof createOrganizationSchema>,
  ): Promise<PlatformOrganizationDetail> {
    return this.organizations.create(body, actorOf(operator));
  }

  @RequirePlatformPermissions(['organizations.view'])
  @Get(':organizationId')
  detail(@Param('organizationId', id) organizationId: string): Promise<PlatformOrganizationDetail> {
    return this.organizations.detail(organizationId);
  }

  @RequirePlatformPermissions(['organizations.manage'])
  @Patch(':organizationId')
  update(
    @Param('organizationId', id) organizationId: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema))
    body: z.output<typeof updateOrganizationSchema>,
  ): Promise<PlatformOrganizationDetail> {
    return this.organizations.update(organizationId, body);
  }

  /** Brings a brand in; `skippedMemberIds` are members the brand had deactivated. */
  @RequirePlatformPermissions(['organizations.manage'])
  @Post(':organizationId/tenants')
  @HttpCode(200)
  attach(
    @Param('organizationId', id) organizationId: string,
    @CurrentPlatformUser() operator: PlatformActor,
    @Body(new ZodValidationPipe(attachOrganizationTenantSchema))
    body: z.output<typeof attachOrganizationTenantSchema>,
  ): Promise<PlatformOrganizationAttached> {
    return this.organizations.attach(organizationId, body.tenantId, actorOf(operator));
  }

  /** `409 LAST_OWNER` when the brand has no active owner of its own. */
  @RequirePlatformPermissions(['organizations.manage'])
  @Delete(':organizationId/tenants/:tenantId')
  @HttpCode(204)
  async detach(
    @Param('organizationId', id) organizationId: string,
    @Param('tenantId', id) tenantId: string,
    @CurrentPlatformUser() operator: PlatformActor,
  ): Promise<void> {
    await this.organizations.detach(organizationId, tenantId, actorOf(operator));
  }

  @RequirePlatformPermissions(['organizations.view'])
  @Get(':organizationId/members')
  members(@Param('organizationId', id) organizationId: string): Promise<MemberDto[]> {
    return this.organizations.members(organizationId);
  }

  @RequirePlatformPermissions(['organizations.manage'])
  @Post(':organizationId/members')
  addMember(
    @Param('organizationId', id) organizationId: string,
    @CurrentPlatformUser() operator: PlatformActor,
    @Body(new ZodValidationPipe(addMemberSchema)) body: z.output<typeof addMemberSchema>,
  ): Promise<LinkedMemberDto> {
    return this.organizations.addMember(organizationId, body, actorOf(operator));
  }

  @RequirePlatformPermissions(['organizations.manage'])
  @Patch(':organizationId/members/:memberId')
  changeRole(
    @Param('organizationId', id) organizationId: string,
    @Param('memberId', id) memberId: string,
    @CurrentPlatformUser() operator: PlatformActor,
    @Body(new ZodValidationPipe(changeMemberRoleSchema))
    body: z.output<typeof changeMemberRoleSchema>,
  ): Promise<LinkedMemberDto> {
    return this.organizations.changeRole(organizationId, memberId, body.role, actorOf(operator));
  }

  @RequirePlatformPermissions(['organizations.manage'])
  @Delete(':organizationId/members/:memberId')
  @HttpCode(204)
  async removeMember(
    @Param('organizationId', id) organizationId: string,
    @Param('memberId', id) memberId: string,
    @CurrentPlatformUser() operator: PlatformActor,
  ): Promise<void> {
    await this.organizations.removeMember(organizationId, memberId, actorOf(operator));
  }
}
