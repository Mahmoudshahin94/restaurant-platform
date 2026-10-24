import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, WebsiteConfig as WebsiteConfigRow } from '@pos/database';
import { DomainError } from '@pos/domain';
import { TenantFileKind, WebsiteSectionType } from '@pos/shared-types';
import {
  type WebsiteConfig,
  type WebsitePreview,
  type WebsiteState,
  defaultWebsiteConfig,
  websiteConfigSchema,
  websiteFileIds,
} from '@pos/validation';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantFilesService } from '../files/tenant-files.service';
import { WebsitePreviewTokens, previewSecret } from './preview-token';
import { TenantDomainsService } from './tenant-domains.service';

const asJson = (config: WebsiteConfig) => config as unknown as Prisma.InputJsonValue;

/**
 * The tenant's website (ADR 0023): a draft the admin edits and a published version visitors see,
 * both checked by `websiteConfigSchema`. Until the tenant publishes, visitors see MADAR's template
 * for its business type. Saving and publishing check that every file, product, category and
 * location the sections name is the tenant's own.
 */
@Injectable()
export class WebsiteService {
  private readonly previews: WebsitePreviewTokens;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: TenantFilesService,
    private readonly domains: TenantDomainsService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.previews = new WebsitePreviewTokens(previewSecret(config));
  }

  async state(tenantId: string): Promise<WebsiteState> {
    const row = await this.prisma.websiteConfig.findUnique({ where: { tenantId } });
    if (!row) {
      return {
        draft: await this.template(tenantId),
        published: null,
        version: 0,
        publishedAt: null,
        updatedAt: null,
        hasUnpublishedChanges: true,
      };
    }
    return toState(row);
  }

  /** What visitors see: the published website, or the template until the first publication. */
  async published(tenantId: string): Promise<WebsiteConfig> {
    const row = await this.prisma.websiteConfig.findUnique({
      where: { tenantId },
      select: { published: true },
    });
    return row?.published ? parse(row.published) : this.template(tenantId);
  }

  /** The draft, for a preview. */
  async draft(tenantId: string): Promise<WebsiteConfig> {
    return (await this.state(tenantId)).draft;
  }

  async saveDraft(tenantId: string, draft: WebsiteConfig): Promise<WebsiteState> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.assertReferences(tx, tenantId, draft);
      const saved = await tx.websiteConfig.upsert({
        where: { tenantId },
        create: { tenantId, draft: asJson(draft) },
        update: { draft: asJson(draft) },
      });
      await this.audit.record(
        {
          action: 'website.draft_saved',
          entityType: 'WebsiteConfig',
          entityId: tenantId,
          tenantId,
          metadata: { sections: draft.sections.length },
        },
        tx,
      );
      return saved;
    });
    return toState(row);
  }

  /** Makes the draft what visitors see, as the next version. */
  async publish(tenantId: string): Promise<WebsiteState> {
    const draft = await this.draft(tenantId);
    const row = await this.prisma.$transaction(async (tx) => {
      // References are checked again: a product or file may have gone since the draft was saved.
      await this.assertReferences(tx, tenantId, draft);
      const current = await tx.websiteConfig.findUnique({ where: { tenantId } });
      const version = (current?.version ?? 0) + 1;
      const now = new Date();
      const published = await tx.websiteConfig.upsert({
        where: { tenantId },
        create: {
          tenantId,
          draft: asJson(draft),
          published: asJson(draft),
          version,
          publishedAt: now,
        },
        update: { published: asJson(draft), version, publishedAt: now },
      });
      await this.audit.record(
        {
          action: 'website.published',
          entityType: 'WebsiteConfig',
          entityId: tenantId,
          tenantId,
          metadata: { version, sections: draft.sections.length },
        },
        tx,
      );
      return published;
    });
    return toState(row);
  }

  /** A link that shows the draft on the tenant's own site for a while. */
  async preview(tenantId: string): Promise<WebsitePreview> {
    const domain = await this.domains.primary(tenantId);
    if (!domain) throw new DomainError('DOMAIN_NOT_FOUND', 'The website has no primary domain');
    const { token, expiresAt } = this.previews.issue(tenantId);
    const url = new URL(this.domains.urlOf(domain));
    url.searchParams.set('preview', token);
    return { token, expiresAt: expiresAt.toISOString(), url: url.toString() };
  }

  /** Whether a preview token is valid for this tenant (another tenant's is worth nothing). */
  previewAllowed(tenantId: string, token: string | undefined): boolean {
    return token !== undefined && this.previews.verify(token.trim()) === tenantId;
  }

  private async template(tenantId: string): Promise<WebsiteConfig> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { businessType: true },
    });
    return defaultWebsiteConfig(tenant.businessType);
  }

  /** Every file, product, category and location a website names belongs to the tenant. */
  private async assertReferences(
    db: PrismaTx,
    tenantId: string,
    config: WebsiteConfig,
  ): Promise<void> {
    await this.files.assertOwned(
      db,
      tenantId,
      websiteFileIds(config).map((id) => ({ id, kind: TenantFileKind.WEBSITE_IMAGE })),
    );
    const products = new Set<string>();
    const categories = new Set<string>();
    const locations = new Set<string>();
    for (const section of config.sections) {
      if (section.type === WebsiteSectionType.FEATURED_PRODUCTS) {
        section.content.productIds.forEach((id) => products.add(id));
        if (section.content.locationId) locations.add(section.content.locationId);
      } else if (section.type === WebsiteSectionType.CATEGORIES) {
        section.content.categoryIds.forEach((id) => categories.add(id));
      } else if (section.type === WebsiteSectionType.OPENING_HOURS && section.content.locationId) {
        locations.add(section.content.locationId);
      }
    }
    const missing = async (
      ids: Set<string>,
      count: (ids: string[]) => Promise<number>,
      code: 'PRODUCT_NOT_FOUND' | 'CATEGORY_NOT_FOUND' | 'LOCATION_NOT_FOUND',
    ) => {
      if (ids.size > 0 && (await count([...ids])) !== ids.size) {
        throw new DomainError(code, 'The website names something that is not the tenant’s');
      }
    };
    await missing(
      products,
      (ids) => db.product.count({ where: { tenantId, id: { in: ids } } }),
      'PRODUCT_NOT_FOUND',
    );
    await missing(
      categories,
      (ids) => db.category.count({ where: { tenantId, id: { in: ids } } }),
      'CATEGORY_NOT_FOUND',
    );
    await missing(
      locations,
      (ids) => db.location.count({ where: { tenantId, id: { in: ids } } }),
      'LOCATION_NOT_FOUND',
    );
  }
}

/** A stored configuration, checked again on the way out (a bad row never reaches a visitor). */
function parse(value: Prisma.JsonValue): WebsiteConfig {
  return websiteConfigSchema.parse(value);
}

function toState(row: WebsiteConfigRow): WebsiteState {
  const draft = parse(row.draft);
  const published = row.published ? parse(row.published) : null;
  return {
    draft,
    published,
    version: row.version,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    hasUnpublishedChanges: JSON.stringify(draft) !== JSON.stringify(published),
  };
}
