import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { Permission } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';
import type { Principal, RequestScope } from './principal';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const PERMISSIONS_KEY = 'auth:permissions';

/** Marks a route (or controller) as reachable without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface PermissionRequirement {
  permissions: readonly Permission[];
  /**
   * How the requirement is evaluated:
   * - `auto` (default): at the `:locationId` route param if present, otherwise restaurant-wide.
   * - `any-location`: satisfied if granted restaurant-wide or at any location; the handler must
   *   then filter results to the caller's accessible locations (e.g. listing locations).
   */
  scope: 'auto' | 'any-location';
}

/**
 * Declares the permissions a route needs. Enforced server-side by PermissionsGuard, which also
 * verifies `:restaurantId` / `:locationId` route params belong to the caller's tenant.
 * Pass an empty list for "any authenticated member of this tenant".
 */
export const RequirePermissions = (
  permissions: readonly Permission[],
  options: { scope?: PermissionRequirement['scope'] } = {},
) =>
  SetMetadata(PERMISSIONS_KEY, {
    permissions,
    scope: options.scope ?? 'auto',
  } satisfies PermissionRequirement);

function requestOf(ctx: ExecutionContext): FastifyRequest {
  return ctx.switchToHttp().getRequest<FastifyRequest>();
}

export const CurrentPrincipal = createParamDecorator<undefined, Principal>(
  (_data: undefined, ctx: ExecutionContext) => {
    const principal = requestOf(ctx).principal;
    if (!principal) throw new DomainError('UNAUTHENTICATED', 'Authentication required');
    return principal;
  },
);

export const CurrentScope = createParamDecorator<undefined, RequestScope>(
  (_data: undefined, ctx: ExecutionContext) => {
    const scope = requestOf(ctx).scope;
    if (!scope) throw new DomainError('INTERNAL_ERROR', 'Route has no authorization scope');
    return scope;
  },
);

export type { Principal, RequestScope };
