import { Inject, Injectable, Logger } from '@nestjs/common';
import { type TenantDomain, newDomainVerificationToken } from '@pos/database';
import { DomainError, customDomainIssue, normalizeHostname, verificationRecord } from '@pos/domain';
import { DomainKind, DomainStatus, MAX_CUSTOM_DOMAINS } from '@pos/shared-types';
import type { TenantDomainDto } from '@pos/validation';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { isUniqueViolation } from '../../prisma/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DOMAIN_VERIFIER, type DomainVerifier } from './domain-verifier';
import { HostTenantResolver } from './host-tenant.resolver';

export function toTenantDomainDto(row: TenantDomain, url: string): TenantDomainDto {
  return {
    id: row.id,
    domain: row.domain,
    url,
    kind: row.kind as DomainKind,
    status: row.status as DomainStatus,
    isPrimary: row.isPrimary,
    verification:
      row.kind === DomainKind.CUSTOM ? verificationRecord(row.domain, row.verificationToken) : null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The domains of a tenant's website (ADR 0023). MADAR's `<slug>.<PLATFORM_WEB_DOMAIN>` is created
 * verified with the tenant. A custom domain starts PENDING with a random token; the tenant
 * publishes the TXT record and asks to verify. Only VERIFIED domains serve the site; the primary
 * one is its canonical address. Every change is audited.
 */
@Injectable()
export class TenantDomainsService {
  private readonly logger = new Logger(TenantDomainsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sites: HostTenantResolver,
    @Inject(DOMAIN_VERIFIER) private readonly verifier: DomainVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(tenantId: string): Promise<TenantDomainDto[]> {
    const rows = await this.prisma.tenantDomain.findMany({
      where: { tenantId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.dto(row));
  }

  /** The tenant's primary domain (its site's canonical address), if it has one. */
  async primary(tenantId: string): Promise<string | null> {
    const row = await this.prisma.tenantDomain.findFirst({
      where: { tenantId, isPrimary: true, status: DomainStatus.VERIFIED },
      select: { domain: true },
    });
    return row?.domain ?? null;
  }

  /** The browser address of a domain (`WEBSITE_URL`). */
  urlOf(domain: string): string {
    return this.config.WEBSITE_URL.replace('{domain}', domain);
  }

  private dto(row: TenantDomain): TenantDomainDto {
    return toTenantDomainDto(row, this.urlOf(row.domain));
  }

  async add(tenantId: string, input: string): Promise<TenantDomainDto> {
    const domain = normalizeHostname(input);
    const issue = domain
      ? customDomainIssue(domain, this.config.PLATFORM_WEB_DOMAIN)
      : ('INVALID' as const);
    if (!domain || issue) {
      throw new DomainError('DOMAIN_INVALID', 'Not a domain a website can use', {
        reason: issue,
      });
    }
    const existing = await this.prisma.tenantDomain.findMany({ where: { tenantId } });
    if (existing.some((d) => d.domain === domain)) {
      throw new DomainError('DOMAIN_TAKEN', 'The domain is already added', {
        reason: 'ALREADY_ADDED',
      });
    }
    if (existing.filter((d) => d.kind === DomainKind.CUSTOM).length >= MAX_CUSTOM_DOMAINS) {
      throw new DomainError('DOMAIN_INVALID', 'Too many custom domains', {
        reason: 'TOO_MANY',
        max: MAX_CUSTOM_DOMAINS,
      });
    }
    await this.assertUnclaimed(tenantId, domain);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenantDomain.create({
        data: {
          tenantId,
          domain,
          kind: DomainKind.CUSTOM,
          status: DomainStatus.PENDING,
          verificationToken: newDomainVerificationToken(),
        },
      });
      await this.audit.record(
        {
          action: 'domain.added',
          entityType: 'TenantDomain',
          entityId: created.id,
          tenantId,
          metadata: { domain },
        },
        tx,
      );
      return created;
    });
    return this.dto(row);
  }

  /**
   * Looks the TXT record up. Found: the domain is VERIFIED and serves the site (unless another
   * tenant verified it first). Not found: FAILED, and `422 DOMAIN_NOT_VERIFIED`; the tenant can
   * try again once DNS has the record. A disabled domain verified again serves again.
   */
  async verify(tenantId: string, domainId: string): Promise<TenantDomainDto> {
    const row = await this.find(tenantId, domainId);
    if (row.kind !== DomainKind.CUSTOM || row.status === DomainStatus.VERIFIED) {
      return this.dto(row);
    }
    let proven: boolean;
    try {
      proven = await this.verifier.verify(row.domain, row.verificationToken);
    } catch (error) {
      this.logger.warn(`DNS lookup for ${row.domain} failed: ${String(error)}`);
      proven = false;
    }
    const now = new Date();
    if (!proven) {
      await this.prisma.$transaction(async (tx) => {
        await tx.tenantDomain.update({
          where: { id: row.id },
          data: { status: DomainStatus.FAILED, lastCheckedAt: now },
        });
        await this.audit.record(
          {
            action: 'domain.verification_failed',
            entityType: 'TenantDomain',
            entityId: row.id,
            tenantId,
            metadata: { domain: row.domain },
          },
          tx,
        );
      });
      throw new DomainError('DOMAIN_NOT_VERIFIED', 'The verification record was not found', {
        record: verificationRecord(row.domain, row.verificationToken),
      });
    }
    await this.assertUnclaimed(tenantId, row.domain);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const verified = await tx.tenantDomain.update({
          where: { id: row.id },
          data: { status: DomainStatus.VERIFIED, verifiedAt: now, lastCheckedAt: now },
        });
        await this.audit.record(
          {
            action: 'domain.verified',
            entityType: 'TenantDomain',
            entityId: row.id,
            tenantId,
            metadata: { domain: row.domain, verifier: this.verifier.name },
          },
          tx,
        );
        return verified;
      });
      return this.dto(updated);
    } catch (error) {
      // Another tenant verified the same name at the same moment (the partial unique index).
      if (isUniqueViolation(error)) throw this.taken();
      throw error;
    }
  }

  async setPrimary(tenantId: string, domainId: string): Promise<TenantDomainDto> {
    const row = await this.find(tenantId, domainId);
    if (row.status !== DomainStatus.VERIFIED) {
      throw new DomainError('DOMAIN_LOCKED', 'Only a verified domain can be primary', {
        reason: 'NOT_VERIFIED',
      });
    }
    if (row.isPrimary) return this.dto(row);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.tenantDomain.updateMany({
        where: { tenantId, isPrimary: true },
        data: { isPrimary: false },
      });
      const primary = await tx.tenantDomain.update({
        where: { id: row.id },
        data: { isPrimary: true },
      });
      await this.audit.record(
        {
          action: 'domain.primary_set',
          entityType: 'TenantDomain',
          entityId: row.id,
          tenantId,
          metadata: { domain: row.domain },
        },
        tx,
      );
      return primary;
    });
    return this.dto(updated);
  }

  /** Stops serving the site on a custom domain (MADAR's address and the primary stay). */
  async disable(tenantId: string, domainId: string): Promise<TenantDomainDto> {
    const row = await this.find(tenantId, domainId);
    if (row.kind === DomainKind.SUBDOMAIN) {
      throw new DomainError('DOMAIN_LOCKED', 'MADAR’s address of the site stays', {
        reason: 'PLATFORM_ADDRESS',
      });
    }
    if (row.isPrimary) {
      throw new DomainError('DOMAIN_LOCKED', 'Choose another primary domain first', {
        reason: 'PRIMARY',
      });
    }
    if (row.status === DomainStatus.DISABLED) return this.dto(row);
    const updated = await this.prisma.$transaction(async (tx) => {
      const disabled = await tx.tenantDomain.update({
        where: { id: row.id },
        data: { status: DomainStatus.DISABLED },
      });
      await this.audit.record(
        {
          action: 'domain.disabled',
          entityType: 'TenantDomain',
          entityId: row.id,
          tenantId,
          metadata: { domain: row.domain, before: row.status },
        },
        tx,
      );
      return disabled;
    });
    return this.dto(updated);
  }

  private async find(tenantId: string, domainId: string): Promise<TenantDomain> {
    const row = await this.prisma.tenantDomain.findFirst({ where: { id: domainId, tenantId } });
    if (!row) throw new DomainError('DOMAIN_NOT_FOUND', 'Domain not found', { domainId });
    return row;
  }

  /** A name another tenant already serves cannot be claimed (pending claims do not count). */
  private async assertUnclaimed(tenantId: string, domain: string): Promise<void> {
    const owner = await this.sites.verifiedOwner(domain);
    if (owner !== null && owner !== tenantId) throw this.taken();
  }

  private taken(): DomainError {
    return new DomainError('DOMAIN_TAKEN', 'Another business serves its website on this domain', {
      reason: 'OTHER_TENANT',
    });
  }
}
