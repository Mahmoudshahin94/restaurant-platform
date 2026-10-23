import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { BrandingImageType, TenantFileKind } from '@pos/shared-types';

/** Injection token of the tenant file storage. */
export const TENANT_FILE_STORAGE = Symbol('TENANT_FILE_STORAGE');

/**
 * Where tenant files (logos, favicons) are kept (ADR 0019). Every key starts with
 * `tenants/<tenantId>/`, and every call names the tenant it acts for: a key outside that tenant's
 * folder is refused, whatever the caller. Files are immutable: a key is written once.
 *
 * The development adapter is `LocalDiskTenantFileStorage`; an object-store adapter (S3 or
 * similar) implements the same interface.
 */
export interface TenantFileStorage {
  /** Writes `bytes` under `key`. Refuses a key outside the tenant's folder, or one already used. */
  put(tenantId: string, key: string, bytes: Uint8Array): Promise<void>;
  /** The bytes under `key`, or null when there are none. */
  get(tenantId: string, key: string): Promise<Buffer | null>;
  /** Whether `key` holds bytes. */
  has(tenantId: string, key: string): Promise<boolean>;
}

/** A key that is not the tenant's: a programming error or an attack, never a user mistake. */
export class TenantFileScopeError extends Error {
  constructor(tenantId: string, key: string) {
    super(`Storage key ${JSON.stringify(key)} is outside tenant ${tenantId}`);
    this.name = 'TenantFileScopeError';
  }
}

/** Refused before an existing file would be replaced. */
export class TenantFileExistsError extends Error {
  constructor(key: string) {
    super(`Storage key ${JSON.stringify(key)} is already used`);
    this.name = 'TenantFileExistsError';
  }
}

const EXTENSION: Record<BrandingImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
};

/** The tenant's folder: the prefix of all its keys. */
export function tenantPrefix(tenantId: string): string {
  return `tenants/${tenantId}/`;
}

/** The key of a new file: `tenants/<tenantId>/<kind>/<fileId>.<ext>`. */
export function tenantFileKey(
  tenantId: string,
  kind: TenantFileKind,
  fileId: string,
  contentType: BrandingImageType,
): string {
  return `${tenantPrefix(tenantId)}${kind.toLowerCase()}/${fileId}.${EXTENSION[contentType]}`;
}

const SAFE_KEY = /^[A-Za-z0-9._/-]+$/;

/** Throws unless `key` is a plain path inside the tenant's folder. */
export function assertTenantKey(tenantId: string, key: string): void {
  const inside =
    SAFE_KEY.test(tenantId) &&
    key.startsWith(tenantPrefix(tenantId)) &&
    SAFE_KEY.test(key) &&
    !key.split('/').some((part) => part === '' || part === '.' || part === '..');
  if (!inside) throw new TenantFileScopeError(tenantId, key);
}

/**
 * Tenant files on the local disk, below one root directory (`FILE_STORAGE_DIR`; on a hub, its
 * data directory). For development and the location hub.
 */
export class LocalDiskTenantFileStorage implements TenantFileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(tenantId: string, key: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathOf(tenantId, key);
    await mkdir(dirname(path), { recursive: true });
    // Written aside, then linked into place: the link fails if the key exists, so a file is
    // never replaced, and a reader never sees half a file.
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new TenantFileExistsError(key);
      throw error;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async get(tenantId: string, key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(tenantId, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async has(tenantId: string, key: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(tenantId, key))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private pathOf(tenantId: string, key: string): string {
    assertTenantKey(tenantId, key);
    const path = resolve(this.root, key);
    // Belt and braces: the resolved path must still lie below the tenant's folder.
    const rel = relative(resolve(this.root, tenantPrefix(tenantId)), path);
    if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
      throw new TenantFileScopeError(tenantId, key);
    }
    return path;
  }
}
