import type { RoleAssignment } from '@pos/domain';

/** The authenticated staff user behind a request, with their role assignments loaded fresh. */
export interface Principal {
  userId: string;
  tenantId: string;
  assignments: readonly RoleAssignment[];
}

/** The tenant scope a request was authorized for (set by PermissionsGuard). */
export interface RequestScope {
  tenantId: string;
  /** Set when the route targets a single location. */
  locationId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    scope?: RequestScope;
  }
}
