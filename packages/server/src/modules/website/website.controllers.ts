import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { DomainError, normalizeHostname } from '@pos/domain';
import { Feature } from '@pos/shared-types';
import {
  type TenantDomainDto,
  type WebsiteConfig,
  type WebsitePreview,
  type WebsiteState,
  addDomainSchema,
  idSchema,
  websiteConfigSchema,
} from '@pos/validation';
import { z } from 'zod';
import { Public, RequirePermissions } from '../../common/auth/decorators';
import { RequireFeature } from '../../common/auth/require-feature';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { HostTenantResolver } from './host-tenant.resolver';
import { TenantDomainsService } from './tenant-domains.service';
import { WebsiteService } from './website.service';

const id = new ZodValidationPipe(idSchema);

/** The website editor (ADR 0023): the draft, publishing it, and a preview link. Cloud only. */
@RequireFeature(Feature.ONLINE_ORDERING)
@Controller('tenants/:tenantId/website')
export class WebsiteController {
  constructor(private readonly website: WebsiteService) {}

  @RequirePermissions(['website.manage'])
  @Get()
  get(@Param('tenantId', id) tenantId: string): Promise<WebsiteState> {
    return this.website.state(tenantId);
  }

  @RequirePermissions(['website.manage'])
  @Put('draft')
  saveDraft(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(websiteConfigSchema)) body: WebsiteConfig,
  ): Promise<WebsiteState> {
    return this.website.saveDraft(tenantId, body);
  }

  @RequirePermissions(['website.manage'])
  @HttpCode(200)
  @Post('publish')
  publish(@Param('tenantId', id) tenantId: string): Promise<WebsiteState> {
    return this.website.publish(tenantId);
  }

  @RequirePermissions(['website.manage'])
  @HttpCode(200)
  @Post('preview')
  preview(@Param('tenantId', id) tenantId: string): Promise<WebsitePreview> {
    return this.website.preview(tenantId);
  }
}

/** The website's domains: MADAR's address, and custom domains verified by DNS (ADR 0023). */
@RequireFeature(Feature.ONLINE_ORDERING)
@Controller('tenants/:tenantId/domains')
export class TenantDomainsController {
  constructor(private readonly domains: TenantDomainsService) {}

  @RequirePermissions(['website.manage'])
  @Get()
  list(@Param('tenantId', id) tenantId: string): Promise<TenantDomainDto[]> {
    return this.domains.list(tenantId);
  }

  @RequirePermissions(['website.manage'])
  @Post()
  add(
    @Param('tenantId', id) tenantId: string,
    @Body(new ZodValidationPipe(addDomainSchema)) body: z.output<typeof addDomainSchema>,
  ): Promise<TenantDomainDto> {
    return this.domains.add(tenantId, body.domain);
  }

  @RequirePermissions(['website.manage'])
  @HttpCode(200)
  @Post(':domainId/verify')
  verify(
    @Param('tenantId', id) tenantId: string,
    @Param('domainId', id) domainId: string,
  ): Promise<TenantDomainDto> {
    return this.domains.verify(tenantId, domainId);
  }

  @RequirePermissions(['website.manage'])
  @HttpCode(200)
  @Post(':domainId/primary')
  setPrimary(
    @Param('tenantId', id) tenantId: string,
    @Param('domainId', id) domainId: string,
  ): Promise<TenantDomainDto> {
    return this.domains.setPrimary(tenantId, domainId);
  }

  @RequirePermissions(['website.manage'])
  @HttpCode(200)
  @Post(':domainId/disable')
  disable(
    @Param('tenantId', id) tenantId: string,
    @Param('domainId', id) domainId: string,
  ): Promise<TenantDomainDto> {
    return this.domains.disable(tenantId, domainId);
  }
}

const domainQuery = new ZodValidationPipe(z.object({ domain: z.string().min(1).max(300) }));

/**
 * The reverse proxy's on-demand TLS check (Caddy's `ask`, ADR 0023): `200` when a certificate may
 * be issued for the domain (a tenant has verified it), `404` otherwise, so certificates are never
 * requested for names nobody verified. Answers only whether a name is served, which DNS shows
 * anyway. Served outside `/api/v1`; the proxy does not expose `/internal` to the internet.
 */
@Public()
@Controller('internal/domains')
export class DomainCheckController {
  constructor(private readonly sites: HostTenantResolver) {}

  @Get('check')
  async check(@Query(domainQuery) query: { domain: string }): Promise<{ domain: string }> {
    const domain = normalizeHostname(query.domain);
    if (!domain || (await this.sites.verifiedOwner(domain)) === null) {
      throw new DomainError('SITE_NOT_FOUND', 'No website answers on this domain');
    }
    return { domain };
  }
}
