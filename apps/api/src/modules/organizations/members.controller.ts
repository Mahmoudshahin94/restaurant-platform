import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ORGANIZATION_ROUTE_ROLES } from '@pos/domain';
import { CurrentPrincipal, type Principal, ZodValidationPipe } from '@pos/server';
import { type MemberDto, addMemberSchema, changeMemberRoleSchema, idSchema } from '@pos/validation';
import type { z } from 'zod';
import { CurrentOrganization, type RequestOrganization } from './organization.guard';
import { OrganizationRoute } from './organization-route';
import { type OrganizationActor, OrganizationService } from './organization.service';

const id = new ZodValidationPipe(idSchema);

const actorOf = (principal: Principal): OrganizationActor => ({
  kind: 'user',
  userId: principal.userId,
});

/** An organization's members (E1), managed by its owners. */
@Controller('organizations/:organizationId/members')
@OrganizationRoute(ORGANIZATION_ROUTE_ROLES.manageMembers)
export class MembersController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get()
  list(@CurrentOrganization() organization: RequestOrganization): Promise<MemberDto[]> {
    return this.organizations.listMembers(organization.id);
  }

  @Post()
  add(
    @CurrentOrganization() organization: RequestOrganization,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(addMemberSchema)) body: z.output<typeof addMemberSchema>,
  ): Promise<MemberDto> {
    return this.organizations.addMember(organization.id, body, actorOf(principal));
  }

  @Patch(':memberId')
  changeRole(
    @CurrentOrganization() organization: RequestOrganization,
    @Param('memberId', id) memberId: string,
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(changeMemberRoleSchema))
    body: z.output<typeof changeMemberRoleSchema>,
  ): Promise<MemberDto> {
    return this.organizations.changeRole(organization.id, memberId, body.role, actorOf(principal));
  }

  @Delete(':memberId')
  @HttpCode(204)
  async remove(
    @CurrentOrganization() organization: RequestOrganization,
    @Param('memberId', id) memberId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<void> {
    await this.organizations.removeMember(organization.id, memberId, actorOf(principal));
  }
}
