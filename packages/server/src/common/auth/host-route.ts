import {
  type ExecutionContext,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { FastifyRequest } from 'fastify';
import { HostTenantGuard } from '../../modules/website/host-tenant.guard';

export const HOST_ROUTE_KEY = 'auth:hostRoute';

/** The tenant website a request's host name resolved to (ADR 0023). */
export interface SiteHost {
  tenantId: string;
  /** The normalized host name the request named. */
  domain: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    site?: SiteHost;
  }
}

/**
 * Marks a route (or controller) of the tenant website: no account, and the tenant is the one
 * whose **verified** domain the request's host names (`HostTenantGuard`). Any tenant id or slug
 * the browser sends is ignored; a host that names no tenant is not found. The route's
 * `:locationId`, if any, must be a location of that tenant. The route inventory lists them as
 * `host` routes.
 */
export const HostRoute = () =>
  applyDecorators(SetMetadata(HOST_ROUTE_KEY, true), UseGuards(HostTenantGuard));

/** The resolved website of a host route. */
export const CurrentSite = createParamDecorator<undefined, SiteHost>(
  (_data: undefined, ctx: ExecutionContext) => {
    const site = ctx.switchToHttp().getRequest<FastifyRequest>().site;
    if (!site) throw new DomainError('INTERNAL_ERROR', 'Route has no resolved website');
    return site;
  },
);
