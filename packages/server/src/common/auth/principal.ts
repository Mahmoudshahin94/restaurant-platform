import type { RoleAssignment } from '@pos/domain';
import type { TenantStatus } from '@pos/shared-types';

/** The authenticated staff user behind a request, with their role assignments loaded fresh. */
export interface Principal {
  userId: string;
  tenantId: string;
  assignments: readonly RoleAssignment[];
  /** The tenant's status when the principal was loaded (ADR 0025): archived tenants only read. */
  tenantStatus: TenantStatus;
}

/**
 * A terminal device acting on its own behalf (a self-service kiosk, ADR 0022): orders and payments
 * it makes record the device as their actor, never a user.
 */
export interface DeviceActor {
  deviceId: string;
  tenantId: string;
}

/**
 * A platform operator repairing a tenant's record with the support tools (ADR 0025): recorded as
 * `PLATFORM` with the operator's id, never as one of the tenant's users.
 */
export interface SupportActor {
  platformUserId: string;
  tenantId: string;
}

/** Who changes an order or takes a payment: a staff member, or a terminal device. */
export type Actor = Principal | DeviceActor;

/** Who may move an order by a SYSTEM rule of the state machine: a terminal, or support. */
export type SystemActor = DeviceActor | SupportActor;

export const isDeviceActor = (actor: Actor | SystemActor): actor is DeviceActor =>
  'deviceId' in actor;
export const isSupportActor = (actor: Actor | SystemActor): actor is SupportActor =>
  'platformUserId' in actor;

/** The tenant scope a request was authorized for (set by PermissionsGuard). */
export interface RequestScope {
  tenantId: string;
  /** Set when the route targets a single location (device routes: the device's location). */
  locationId: string | null;
  /** Device routes: the terminal calling (ADR 0022), so modules resolve with its device layer. */
  deviceId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    scope?: RequestScope;
  }
}
