import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { TenantFile as TenantFileRow } from '@pos/database';
import { DomainError, newId } from '@pos/domain';
import {
  BRANDING_IMAGE_TYPES,
  type BrandingImageType,
  TENANT_FILE_MAX_BYTES,
  type TenantFileKind,
} from '@pos/shared-types';
import type { TenantFileDto } from '@pos/validation';
import { type PrismaTx, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { canonicalImageType, sniffImageType } from './image-type';
import { TENANT_FILE_STORAGE, type TenantFileStorage, tenantFileKey } from './tenant-file-storage';

/** What each kind of file may be: a favicon may also be an ICO. */
const ACCEPTED: Record<TenantFileKind, readonly BrandingImageType[]> = {
  LOGO: ['image/png', 'image/jpeg', 'image/webp'],
  FAVICON: BRANDING_IMAGE_TYPES,
  PRODUCT_IMAGE: ['image/png', 'image/jpeg', 'image/webp'],
  WEBSITE_IMAGE: ['image/png', 'image/jpeg', 'image/webp'],
};

export function toTenantFileDto(row: TenantFileRow): TenantFileDto {
  return {
    id: row.id,
    kind: row.kind as TenantFileKind,
    contentType: row.contentType as BrandingImageType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The tenant's uploaded files (ADR 0019): logos and favicons. Raster images only, checked by
 * their bytes, not by what the browser claims. Every read and write names the tenant, both in
 * the database (scoped client) and in the storage (keys inside the tenant's folder).
 */
@Injectable()
export class TenantFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(TENANT_FILE_STORAGE) private readonly storage: TenantFileStorage,
  ) {}

  async upload(
    tenantId: string,
    kind: TenantFileKind,
    declaredType: string | undefined,
    body: unknown,
  ): Promise<TenantFileDto> {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new DomainError('FILE_TYPE_NOT_ALLOWED', 'Send the image bytes as the request body');
    }
    const declared = canonicalImageType(declaredType);
    const actual = sniffImageType(body);
    const accepted = ACCEPTED[kind] as readonly string[];
    if (!accepted.includes(declared) || actual !== declared) {
      throw new DomainError('FILE_TYPE_NOT_ALLOWED', 'Not an accepted image type', {
        kind,
        accepted,
      });
    }
    const maxBytes = TENANT_FILE_MAX_BYTES[kind];
    if (body.length > maxBytes) {
      throw new DomainError('FILE_TOO_LARGE', 'The file is too large', { kind, maxBytes });
    }
    const id = newId();
    const storageKey = tenantFileKey(tenantId, kind, id, actual);
    // Bytes first: a row never points at nothing. A failed insert leaves unreferenced bytes,
    // which are harmless (nothing can name them).
    await this.storage.put(tenantId, storageKey, body);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenantFile.create({
        data: {
          id,
          tenantId,
          kind,
          storageKey,
          contentType: actual,
          sizeBytes: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
        },
      });
      await this.audit.record(
        {
          action: 'tenant_file.uploaded',
          entityType: 'TenantFile',
          entityId: id,
          tenantId,
          metadata: { kind, contentType: actual, sizeBytes: body.length },
        },
        tx,
      );
      return created;
    });
    return toTenantFileDto(row);
  }

  async list(tenantId: string, kind?: TenantFileKind): Promise<TenantFileDto[]> {
    const rows = await this.prisma.tenantFile.findMany({
      where: { tenantId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toTenantFileDto);
  }

  /** A file of the tenant and its bytes; another tenant's file is not found. */
  async content(
    tenantId: string,
    fileId: string,
    db: PrismaTx = this.prisma,
  ): Promise<{ file: TenantFileDto; bytes: Buffer }> {
    const row = await db.tenantFile.findFirst({ where: { id: fileId, tenantId } });
    if (!row) throw new DomainError('FILE_NOT_FOUND', 'File not found', { fileId });
    const bytes = await this.storage.get(tenantId, row.storageKey);
    if (!bytes) throw new DomainError('FILE_NOT_FOUND', 'File not found', { fileId });
    return { file: toTenantFileDto(row), bytes };
  }

  /**
   * The tenant's files with these ids, all of them, of the expected kind. Branding refers to
   * files by id; one that is not the tenant's is not found.
   */
  async assertOwned(
    db: PrismaTx,
    tenantId: string,
    ids: { id: string; kind: TenantFileKind }[],
  ): Promise<TenantFileRow[]> {
    if (ids.length === 0) return [];
    const rows = await db.tenantFile.findMany({
      where: { tenantId, id: { in: [...new Set(ids.map((i) => i.id))] } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const { id, kind } of ids) {
      const row = byId.get(id);
      if (!row) throw new DomainError('FILE_NOT_FOUND', 'File not found', { fileId: id });
      if (row.kind !== kind) {
        throw new DomainError('FILE_TYPE_NOT_ALLOWED', `This file is not a ${kind.toLowerCase()}`, {
          fileId: id,
          kind,
        });
      }
    }
    return rows;
  }
}
