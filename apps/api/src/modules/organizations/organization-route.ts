import { SetMetadata, UseGuards, UseInterceptors, applyDecorators } from '@nestjs/common';
import { ORGANIZATION_ROUTE_KEY } from '@pos/server';
import type { OrganizationRole } from '@pos/shared-types';
import { OrganizationGuard, OrganizationScopeInterceptor } from './organization.guard';

/**
 * Marks a route (or controller) of an organization's pages (`/organizations/:organizationId/*`,
 * E1) and the organization roles allowed (`ORGANIZATION_ROUTE_ROLES`). A staff token whose account
 * is a member in one of those roles: `OrganizationGuard` checks it, then the handler runs in the
 * organization's read-only scope. The route inventory lists these routes as `organization`.
 */
export const OrganizationRoute = (roles: readonly OrganizationRole[]) =>
  applyDecorators(
    SetMetadata(ORGANIZATION_ROUTE_KEY, roles),
    UseGuards(OrganizationGuard),
    UseInterceptors(OrganizationScopeInterceptor),
  );
