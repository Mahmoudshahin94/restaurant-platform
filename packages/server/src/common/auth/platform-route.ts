import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { PlatformPermission, PlatformRole } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';

export const PLATFORM_PERMISSIONS_KEY = 'auth:platformPermissions';

/** The platform guard's name: every platform route must be behind it (`assertEveryRouteProtected`). */
export const PLATFORM_GUARD_NAME = 'PlatformGuard';

/** A MADAR operator calling the platform API (ADR 0025), loaded fresh on every request. */
export interface PlatformActor {
  id: string;
  role: PlatformRole;
  permissions: readonly PlatformPermission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    platformUser?: PlatformActor;
  }
}

/**
 * Marks a route (or controller) of the platform admin's API (ADR 0025) and the platform
 * permissions it needs (an empty list: any platform user). Such a route takes platform tokens
 * only: the global staff guards let it through untouched, and the cloud's `PlatformGuard`
 * (`@UseGuards`, required by the start-up check) authenticates the operator and checks the
 * permissions. Staff tokens, device credentials and anonymous calls are refused; the route
 * inventory lists these routes as `platform`.
 */
export const RequirePlatformPermissions = (permissions: readonly PlatformPermission[]) =>
  SetMetadata(PLATFORM_PERMISSIONS_KEY, permissions);

/** The operator of a platform route. */
export const CurrentPlatformUser = createParamDecorator<undefined, PlatformActor>(
  (_data: undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest<FastifyRequest>().platformUser;
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Platform authentication required');
    return user;
  },
);
