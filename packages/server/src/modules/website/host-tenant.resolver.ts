import { Inject, Injectable } from '@nestjs/common';
import { normalizeHostname } from '@pos/domain';
import { DomainStatus } from '@pos/shared-types';
import type { SiteHost } from '../../common/auth/host-route';
import { TenantContext } from '../../common/tenancy/tenant-context';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

/** Hosts that name no tenant: the development fallback may apply to them, and to nothing else. */
const DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Which tenant a website request is for (ADR 0023). The request's host name is the only input:
 * it is looked up among **verified** domains, across tenants (the caller has no tenant yet, so
 * this file is on the `pos-local/no-unscoped-prisma` allowlist). A pending, failed or disabled
 * domain, or an unknown one, resolves to nothing, so a domain nobody verified can never show a
 * tenant's site, and a name claimed by one tenant can never reach another's.
 */
@Injectable()
export class HostTenantResolver {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async resolve(host: string | undefined): Promise<SiteHost | null> {
    const domain = host ? normalizeHostname(host) : null;
    if (!domain) return null;
    const tenantId = await this.verifiedOwner(domain);
    if (tenantId) return { tenantId, domain };
    return this.developmentFallback(domain);
  }

  /** The tenant a domain is verified for, if any (the TLS `ask` check, and claims). */
  async verifiedOwner(domain: string): Promise<string | null> {
    const row = await TenantContext.runUnscoped(
      'website: find the tenant of a verified domain',
      () =>
        this.prisma.tenantDomain.findFirst({
          where: { domain, status: DomainStatus.VERIFIED },
          select: { tenantId: true },
        }),
    );
    return row?.tenantId ?? null;
  }

  /**
   * Development only (`DEV_DEFAULT_TENANT_SLUG`, refused in production by the configuration):
   * bare `localhost` shows that tenant's site, so the website runs without a `*.localhost` host.
   */
  private async developmentFallback(domain: string): Promise<SiteHost | null> {
    const slug = this.config.DEV_DEFAULT_TENANT_SLUG;
    if (!slug || this.config.NODE_ENV === 'production' || !DEV_HOSTS.has(domain)) return null;
    const tenant = await TenantContext.runUnscoped('website: the development default tenant', () =>
      this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } }),
    );
    return tenant ? { tenantId: tenant.id, domain } : null;
  }
}
