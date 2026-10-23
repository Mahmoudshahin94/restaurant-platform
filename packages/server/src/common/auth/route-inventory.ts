import { RequestMethod, type INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { Permission } from '@pos/shared-types';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, type PermissionRequirement } from './decorators';

/**
 * How a route is protected:
 * - `public`: no credential at all (sign-in, health, the storefront);
 * - `guarded`: `@Public()` for staff but behind its own guard (the hubs' device credential);
 * - `permissions`: a staff access token and `@RequirePermissions`;
 * - `unprotected`: none of these — refused at runtime by the permissions guard, and at start-up by
 *   `assertEveryRouteProtected`.
 */
export type RouteAccess = 'public' | 'guarded' | 'permissions' | 'unprotected';

export interface RouteEntry {
  method: string;
  /** Path without the global prefix, with `:params` (e.g. `/locations/:locationId/orders`). */
  path: string;
  access: RouteAccess;
  permissions: readonly Permission[];
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
        const guards = guardNames(controller, handler);
        const access: RouteAccess = isPublic
          ? guards.length > 0
            ? 'guarded'
            : 'public'
          : requirement
            ? 'permissions'
            : 'unprotected';
        routes.push({
          method: RequestMethod[method],
          path: joinPath(base, firstPath(Reflect.getMetadata(PATH_METADATA, handler))),
          access,
          permissions: requirement?.permissions ?? [],
          guards,
          handler: `${controller.name}.${name}`,
        });
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * Refuses to start a server with a route that is neither public nor declares its permissions.
 * The permissions guard already denies such a route at runtime; failing at start-up makes the
 * mistake impossible to ship (ADR 0016).
 */
export function assertEveryRouteProtected(app: INestApplication): void {
  const unprotected = listRoutes(app).filter((route) => route.access === 'unprotected');
  if (unprotected.length > 0) {
    const list = unprotected.map((r) => `${r.method} ${r.path} (${r.handler})`).join(', ');
    throw new Error(`Routes without @Public() or @RequirePermissions: ${list}`);
  }
}
