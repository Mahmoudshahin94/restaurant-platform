import { RequestMethod, type INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type {
  Feature,
  OrganizationRole,
  Permission,
  PlatformPermission,
  TerminalDeviceType,
} from '@pos/shared-types';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, type PermissionRequirement } from './decorators';
import { DEVICE_ROUTE_KEY } from './device-route';
import { HOST_ROUTE_KEY } from './host-route';
import { ORGANIZATION_GUARD_NAME, ORGANIZATION_ROUTE_KEY } from './organization-route';
import { PLATFORM_GUARD_NAME, PLATFORM_PERMISSIONS_KEY } from './platform-route';
import { requiredFeaturesOf } from './require-feature';

/**
 * How a route is protected:
 * - `public`: no credential at all (sign-in, health, the storefront);
 * - `guarded`: `@Public()` for staff but behind its own guard (the hubs' device credential);
 * - `permissions`: a staff access token and `@RequirePermissions`;
 * - `device`: a terminal's device credential and `@DeviceRoute` (a kiosk at its hub, ADR 0022);
 * - `host`: the tenant website, `@HostRoute`: no credential, the tenant is the one whose verified
 *   domain the request's host names (`HostTenantGuard`, ADR 0023);
 * - `platform`: MADAR's operators, `@RequirePlatformPermissions`: a platform token only, checked
 *   by `PlatformGuard` (ADR 0025); staff tokens and device credentials are refused;
 * - `organization`: an organization's pages, `@OrganizationRoute`: a staff token whose account is
 *   a member of the organization in one of the route's roles, checked by `OrganizationGuard` (E1);
 * - `unprotected`: none of these — refused at runtime by the permissions guard, and at start-up by
 *   `assertEveryRouteProtected`.
 */
export type RouteAccess =
  | 'public'
  | 'guarded'
  | 'permissions'
  | 'device'
  | 'host'
  | 'platform'
  | 'organization'
  | 'unprotected';

export interface RouteEntry {
  method: string;
  /** Path without the global prefix, with `:params` (e.g. `/locations/:locationId/orders`). */
  path: string;
  access: RouteAccess;
  permissions: readonly Permission[];
  /** Platform routes: the platform permissions the operator needs (an empty list: any). */
  platformPermissions: readonly PlatformPermission[];
  /** Organization routes: the organization roles allowed. */
  organizationRoles: readonly OrganizationRole[];
  /** Modules the route needs (`@RequireFeature`); refused with FEATURE_DISABLED while off. */
  features: readonly Feature[];
  /** Device routes: the terminal types it serves. */
  devices: readonly TerminalDeviceType[];
  /** Class names of route-specific guards (e.g. `DeviceGuard`). */
  guards: string[];
  handler: string;
}

const joinPath = (...parts: (string | undefined)[]): string => {
  const path = parts
    .flatMap((p) => (p ?? '').split('/'))
    .filter((segment) => segment.length > 0)
    .join('/');
  return `/${path}`;
};

const firstPath = (value: unknown): string | undefined =>
  Array.isArray(value) ? (value[0] as string | undefined) : (value as string | undefined);

function guardNames(...targets: object[]): string[] {
  return targets.flatMap((target) =>
    ((Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[]).map((guard) =>
      typeof guard === 'function' ? guard.name : (guard?.constructor.name ?? 'anonymous'),
    ),
  );
}

/** Every HTTP route the application's controllers declare, with how it is protected. */
export function listRoutes(app: INestApplication): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const reflector = new Reflector();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!controller) continue;
      const base = firstPath(Reflect.getMetadata(PATH_METADATA, controller));
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const isPublic =
          (Reflect.getMetadata(IS_PUBLIC_KEY, handler) ??
            Reflect.getMetadata(IS_PUBLIC_KEY, controller)) === true;
        const requirement = (Reflect.getMetadata(PERMISSIONS_KEY, handler) ??
          Reflect.getMetadata(PERMISSIONS_KEY, controller)) as PermissionRequirement | undefined;
        const devices = (Reflect.getMetadata(DEVICE_ROUTE_KEY, handler) ??
          Reflect.getMetadata(DEVICE_ROUTE_KEY, controller)) as TerminalDeviceType[] | undefined;
        const isHost =
          (Reflect.getMetadata(HOST_ROUTE_KEY, handler) ??
            Reflect.getMetadata(HOST_ROUTE_KEY, controller)) === true;
        const platform = (Reflect.getMetadata(PLATFORM_PERMISSIONS_KEY, handler) ??
          Reflect.getMetadata(PLATFORM_PERMISSIONS_KEY, controller)) as
          PlatformPermission[] | undefined;
        const organization = (Reflect.getMetadata(ORGANIZATION_ROUTE_KEY, handler) ??
          Reflect.getMetadata(ORGANIZATION_ROUTE_KEY, controller)) as
          OrganizationRole[] | undefined;
        const guards = guardNames(controller, handler);
        const access: RouteAccess = isHost
          ? 'host'
          : platform && !isPublic
            ? 'platform'
            : organization && !isPublic
              ? 'organization'
              : isPublic
                ? guards.length > 0
                  ? 'guarded'
                  : 'public'
                : devices
                  ? 'device'
                  : requirement
                    ? 'permissions'
                    : 'unprotected';
        routes.push({
          method: RequestMethod[method],
          path: joinPath(base, firstPath(Reflect.getMetadata(PATH_METADATA, handler))),
          access,
          permissions: requirement?.permissions ?? [],
          platformPermissions: platform ?? [],
          organizationRoles: organization ?? [],
          features: requiredFeaturesOf(reflector, [handler, controller]),
          devices: devices ?? [],
          guards,
          handler: `${controller.name}.${name}`,
        });
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * Refuses to start a server with a route that is neither public nor declares its permissions (or
 * the devices it serves, or its website), and with a route that declares two audiences.
 * The permissions guard already denies such a route at runtime; failing at start-up makes the
 * mistake impossible to ship (ADR 0016).
 */
export function assertEveryRouteProtected(app: INestApplication): void {
  const routes = listRoutes(app);
  const platformMixed = routes.filter((r) =>
    r.access === 'platform'
      ? r.permissions.length > 0 || r.devices.length > 0
      : r.platformPermissions.length > 0,
  );
  if (platformMixed.length > 0) {
    const list = platformMixed.map((r) => `${r.method} ${r.path} (${r.handler})`).join(', ');
    throw new Error(
      `Platform routes cannot be public or also require staff permissions or devices: ${list}`,
    );
  }
  const unguardedPlatform = routes.filter(
    (r) => r.access === 'platform' && !r.guards.includes(PLATFORM_GUARD_NAME),
  );
  if (unguardedPlatform.length > 0) {
    const list = unguardedPlatform.map((r) => `${r.method} ${r.path} (${r.handler})`).join(', ');
    throw new Error(`Platform routes must authenticate with ${PLATFORM_GUARD_NAME}: ${list}`);
  }
  const organizationMixed = routes.filter((r) =>
    r.access === 'organization'
      ? r.permissions.length > 0 || r.devices.length > 0 || r.organizationRoles.length === 0
      : r.organizationRoles.length > 0,
  );
  if (organizationMixed.length > 0) {
    const list = organizationMixed.map((r) => `${r.method} ${r.path} (${r.handler})`).join(', ');
    throw new Error(
      `Organization routes need their roles and cannot be public, platform routes or also require staff permissions or devices: ${list}`,
    );
  }
  const unguardedOrganization = routes.filter(
    (r) => r.access === 'organization' && !r.guards.includes(ORGANIZATION_GUARD_NAME),
  );
  if (unguardedOrganization.length > 0) {
    const list = unguardedOrganization
      .map((r) => `${r.method} ${r.path} (${r.handler})`)
      .join(', ');
    throw new Error(`Organization routes must authorize with ${ORGANIZATION_GUARD_NAME}: ${list}`);
  }
  const hostMixed = routes.filter(
    (r) => r.access === 'host' && (r.permissions.length > 0 || r.devices.length > 0),
  );
  if (hostMixed.length > 0) {
    const list = hostMixed.map((r) => `${r.method} ${r.path} (${r.handler})`).join(', ');
    throw new Error(`Website routes cannot also require staff permissions or devices: ${list}`);
  }
  const hostless = routes.filter(
    (r) => r.access === 'host' && !r.guards.includes('HostTenantGuard'),
  );
  if (hostless.length > 0) {
    const list = hostless.map((r) => `${r.method} ${r.path} (${r.handler})`).join(', ');
    throw new Error(`Website routes must resolve their tenant with HostTenantGuard: ${list}`);
  }
  const mixed = routes.filter((r) => r.access === 'device' && r.permissions.length > 0);
  if (mixed.length > 0) {
    const list = mixed.map((r) => `${r.method} ${r.path} (${r.handler})`).join(', ');
    throw new Error(`Device routes cannot also require staff permissions: ${list}`);
  }
  const unprotected = routes.filter((route) => route.access === 'unprotected');
  if (unprotected.length > 0) {
    const list = unprotected.map((r) => `${r.method} ${r.path} (${r.handler})`).join(', ');
    throw new Error(
      `Routes without @Public(), @RequirePermissions, @DeviceRoute, @HostRoute, @RequirePlatformPermissions or @OrganizationRoute: ${list}`,
    );
  }
}
