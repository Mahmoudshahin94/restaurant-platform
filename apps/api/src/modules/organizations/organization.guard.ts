import {
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, isUuid } from '@pos/domain';
import { ORGANIZATION_ROUTE_KEY, PrismaService, TenantContext } from '@pos/server';
import type { OrganizationRole } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';
import { Observable, type Subscription } from 'rxjs';

/** The organization an organization route works for, and the caller's role in it. */
export interface RequestOrganization {
  id: string;
  role: OrganizationRole;
  /** Its brands, oldest first. */
  tenantIds: string[];
  /** Every brand's currency (one per organization). */
  currencyCode: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    organization?: RequestOrganization;
  }
}

const notFound = () => new DomainError('ORGANIZATION_NOT_FOUND', 'Organization not found');

/**
 * Authorizes `/organizations/:organizationId/*` (E1), after the global guards authenticated the
 * staff token: the caller's account must be a member of that organization, and the organization
 * active — anything else (an unknown id, another organization, a brand user who is no member, a
 * suspended organization) is "not found", so organizations are not disclosed. A member whose role
 * the route does not allow is refused (403). Works whichever brand the caller is signed into.
 */
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    if (!principal) throw new DomainError('UNAUTHENTICATED', 'Authentication required');
    const roles = this.reflector.getAllAndOverride<OrganizationRole[] | undefined>(
      ORGANIZATION_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const { organizationId } = (request.params ?? {}) as { organizationId?: string };
    if (!roles || !organizationId || !isUuid(organizationId)) throw notFound();

    const user = await TenantContext.runInTenant(principal.tenantId, () =>
      this.prisma.user.findUnique({
        where: { id: principal.userId },
        select: { accountId: true },
      }),
    );
    if (!user) throw notFound();
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_accountId: { organizationId, accountId: user.accountId } },
      select: {
        role: true,
        organization: {
          select: {
            status: true,
            currencyCode: true,
            tenants: { select: { id: true }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (member?.organization.status !== 'ACTIVE') throw notFound();
    if (!roles.includes(member.role)) {
      throw new DomainError('INSUFFICIENT_PERMISSION', 'This organization role may not do this', {
        role: member.role,
      });
    }
    request.organization = {
      id: organizationId,
      role: member.role,
      tenantIds: member.organization.tenants.map((t) => t.id),
      currencyCode: member.organization.currencyCode,
    };
    return true;
  }
}

/**
 * Runs an organization route's handler in the organization's scope (`runInOrganization`): reads
 * of tenant data cover its brands, writes through the scoped client are refused. Applied with the
 * guard by `@OrganizationRoute`.
 */
@Injectable()
export class OrganizationScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const organization = context.switchToHttp().getRequest<FastifyRequest>().organization;
    if (!organization) throw notFound();
    return new Observable((subscriber) => {
      let inner: Subscription | undefined;
      TenantContext.runInOrganization(organization.id, organization.tenantIds, () => {
        inner = next.handle().subscribe(subscriber);
      }).catch((error: unknown) => {
        subscriber.error(error);
      });
      return () => inner?.unsubscribe();
    });
  }
}

/** The organization of an organization route (set by `OrganizationGuard`). */
export const CurrentOrganization = createParamDecorator<undefined, RequestOrganization>(
  (_data: undefined, ctx: ExecutionContext) => {
    const organization = ctx.switchToHttp().getRequest<FastifyRequest>().organization;
    if (!organization) throw new DomainError('INTERNAL_ERROR', 'Route has no organization');
    return organization;
  },
);
