import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  DomainError,
  canAccessLocation,
  hasAllPermissions,
  isUuid,
  resolvePermissions,
} from '@pos/domain';
import type { Permission } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../tenancy/tenant-context';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY, type PermissionRequirement } from './decorators';
import { type AuthenticatedTerminal, DEVICE_ROUTE_KEY } from './device-route';
import { HOST_ROUTE_KEY } from './host-route';
import type { Principal, RequestScope } from './principal';

type Params = Record<string, string | undefined>;

/**
 * Global guard, runs after AuthGuard. Deny-by-default: a protected route without
 * @RequirePermissions is rejected. Verifies tenant ownership of `:tenantId` / `:locationId`
 * (answering 404 so other tenants' ids are not disclosed), then checks permissions in scope.
 * Device routes (ADR 0022) have no permissions: the route is the terminal's whole authority, at
 * its own location only.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;
    // Website routes are scoped by HostTenantGuard, which runs after the global guards.
    if (this.reflector.getAllAndOverride<boolean | undefined>(HOST_ROUTE_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (this.reflector.getAllAndOverride<unknown>(DEVICE_ROUTE_KEY, targets)) {
      const terminal = request.terminal;
      if (!terminal) throw new DomainError('UNAUTHENTICATED', 'Device authentication required');
      request.scope = this.terminalScope(terminal, (request.params ?? {}) as Params);
      return true;
    }
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    if (!requirement) {
      this.logger.error(`Route ${request.method} ${request.url} has no @RequirePermissions`);
      throw new DomainError(
        'INSUFFICIENT_PERMISSION',
        'Route is not authorized for any permission',
      );
    }
    const principal = request.principal;
    if (!principal) throw new DomainError('UNAUTHENTICATED', 'Authentication required');

    const params = (request.params ?? {}) as Params;
    request.scope = await this.resolveScope(principal, params);
    this.assertGranted(principal, request.scope, requirement);
    return true;
  }

  /** A terminal works at its own location: another location (or tenant) is not found. */
  private terminalScope(terminal: AuthenticatedTerminal, params: Params): RequestScope {
    if (params.tenantId !== undefined && params.tenantId !== terminal.tenantId) {
      throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    }
    if (params.locationId !== undefined && params.locationId !== terminal.locationId) {
      throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    }
    return { tenantId: terminal.tenantId, locationId: terminal.locationId, deviceId: terminal.id };
  }

  private async resolveScope(
    principal: Principal,
    params: Record<string, string | undefined>,
  ): Promise<RequestScope> {
    const { tenantId, locationId } = params;
    if (tenantId !== undefined && tenantId !== principal.tenantId) {
      throw new DomainError('TENANT_NOT_FOUND', 'Tenant not found');
    }
    if (locationId !== undefined) {
      if (!isUuid(locationId)) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
      const location = await TenantContext.runInTenant(principal.tenantId, () =>
        this.prisma.location.findUnique({ where: { id: locationId }, select: { tenantId: true } }),
      );
      if (location?.tenantId !== principal.tenantId) {
        throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
      }
      return { tenantId: principal.tenantId, locationId };
    }
    return { tenantId: principal.tenantId, locationId: null };
  }

  private assertGranted(
    principal: Principal,
    scope: RequestScope,
    requirement: PermissionRequirement,
  ): void {
    const { assignments } = principal;
    const required = requirement.permissions;

    if (scope.locationId !== null) {
      if (!canAccessLocation(assignments, scope.locationId)) {
        throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
      }
      this.check(resolvePermissions(assignments, scope.locationId), required);
      return;
    }

    if (requirement.scope === 'any-location') {
      const scopes = [null, ...new Set(assignments.map((a) => a.locationId))];
      const satisfied = scopes.some((s) =>
        hasAllPermissions(resolvePermissions(assignments, s), required),
      );
      if (!satisfied) this.deny(required, resolvePermissions(assignments, null));
      return;
    }

    this.check(resolvePermissions(assignments, null), required);
  }

  private check(granted: ReadonlySet<Permission>, required: readonly Permission[]): void {
    if (!hasAllPermissions(granted, required)) this.deny(required, granted);
  }

  private deny(required: readonly Permission[], granted: ReadonlySet<Permission>): never {
    throw new DomainError('INSUFFICIENT_PERMISSION', 'Missing required permissions', {
      missing: required.filter((p) => !granted.has(p)),
    });
  }
}
