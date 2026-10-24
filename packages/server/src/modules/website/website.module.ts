import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import {
  DOMAIN_VERIFIER,
  DnsDomainVerifier,
  type DomainVerifier,
  MockDomainVerifier,
} from './domain-verifier';
import { HostTenantGuard } from './host-tenant.guard';
import { HostTenantResolver } from './host-tenant.resolver';
import { TenantDomainsService } from './tenant-domains.service';
import {
  DomainCheckController,
  TenantDomainsController,
  WebsiteController,
} from './website.controllers';
import { WebsiteService } from './website.service';

/**
 * The tenant website (ADR 0023): domains, host resolution and the website configuration. **Cloud
 * only**: the website and its domains are served by the cloud, so the hub never loads it (its
 * tables are cloud-only too).
 */
@Module({
  controllers: [WebsiteController, TenantDomainsController, DomainCheckController],
  providers: [
    {
      provide: DOMAIN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DomainVerifier =>
        config.DOMAIN_VERIFIER === 'mock' ? new MockDomainVerifier() : new DnsDomainVerifier(),
    },
    HostTenantResolver,
    HostTenantGuard,
    TenantDomainsService,
    WebsiteService,
  ],
  exports: [
    HostTenantResolver,
    HostTenantGuard,
    TenantDomainsService,
    WebsiteService,
    DOMAIN_VERIFIER,
  ],
})
export class WebsiteModule {}
