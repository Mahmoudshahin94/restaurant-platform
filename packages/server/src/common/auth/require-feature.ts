import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@pos/domain';
import type { Feature } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';
import { FeatureService } from '../../modules/features/feature.service';
import { requestMemo } from '../context/request-context';
import { IS_PUBLIC_KEY } from './decorators';
import { HOST_ROUTE_KEY } from './host-route';

export const REQUIRED_FEATURES_KEY = 'features:required';

/**
 * Declares the modules a route (or a whole controller) needs (ADR 0018). Refused with
 * `403 FEATURE_DISABLED` while one is off for the route's tenant and `:locationId`. The route
 * inventory records them, and the security tests call every such route with the module off.
 */
export const RequireFeature = (...features: Feature[]) =>
  SetMetadata(REQUIRED_FEATURES_KEY, features);

/** The modules a handler requires: its own and its controller's. */
export function requiredFeaturesOf(
  reflector: Reflector,
  targets: Parameters<Reflector['getAllAndMerge']>[1],
): Feature[] {
  const merged = reflector.getAllAndMerge<Feature[]>(REQUIRED_FEATURES_KEY, targets);
  return [...new Set(merged)];
}

/**
 * Global guard, runs after PermissionsGuard (which has checked the tenant and location the route
 * names). Staff routes are checked here, against the request's scope. A public or website route has
 * no tenant yet: its required modules travel with the request, and `HostTenantGuard` checks them
 * once the host name has given the tenant (ADR 0023).
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = requiredFeaturesOf(this.reflector, targets);
    if (required.length === 0) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean | undefined>(HOST_ROUTE_KEY, targets)
    ) {
      request.requiredFeatures = required;
      return true;
    }
    const scope = request.scope;
    if (!scope) throw new DomainError('INTERNAL_ERROR', 'Route has no authorization scope');
    await this.features.assertEnabled(required, scope, { memo: requestMemo(request) });
    return true;
  }
}
