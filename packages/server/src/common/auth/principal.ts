import type { RoleAssignment } from '@pos/domain';

/** The authenticated staff user behind a request, with their role assignments loaded fresh. */
export interface Principal {
  userId: string;
  tenantId: string;
  assignments: readonly RoleAssignment[];
}

/**
 * A terminal device acting on its own behalf (a self-service kiosk, ADR 0022): orders and payments
 * it makes record the device as their actor, never a user.
 */
export interface DeviceActor {
  deviceId: string;
  tenantId: string;
}

/** Who changes an order or takes a payment: a staff member, or a terminal device. */
export type Actor = Principal | DeviceActor;

export const isDeviceActor = (actor: Actor): actor is DeviceActor => 'deviceId' in actor;

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
