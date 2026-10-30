import { createHash } from 'node:crypto';
import { sniffImageType, type TenantFileStorage } from '@pos/server';
import { TenantFileKind } from '@pos/shared-types';
import type { HubTx } from '../database/hub-database';
import type { Pairing } from '../hub-state.service';
import { hubHeaders } from '../sync/cloud-client';

/**
 * Downloads the product pictures the hub's menu shows and it does not have yet (ADR 0027). The
 * snapshot names them (rows of `product_images` and their `tenant_files`) without their bytes,
 * so a menu edit does not resend every picture; each file is fetched once, checked against the
 * SHA-256, size and type its row declares, and kept in the hub's file storage. A picture that
 * cannot be fetched now is tried again after the next snapshot; the screens show the product's
 * name meanwhile. Returns how many files were stored.
 */
export async function fetchProductPictures(
  db: HubTx,
  storage: TenantFileStorage,
  pairing: Pairing,
  timeoutMs: number,
): Promise<number> {
  const rows = await db.tenantFile.findMany({
    where: { kind: TenantFileKind.PRODUCT_IMAGE, productImages: { some: {} } },
    orderBy: { id: 'asc' },
  });
  let stored = 0;
  for (const row of rows) {
    if (await storage.has(row.tenantId, row.storageKey)) continue;
    let bytes: Buffer;
    try {
      const response = await fetch(`${pairing.cloudUrl}/api/v1/sync/files/${row.id}`, {
        headers: hubHeaders(pairing.credential),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      bytes = Buffer.from(await response.arrayBuffer());
    } catch {
      // The cloud is unreachable: the next snapshot tries again.
      return stored;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (
      sha256 !== row.sha256 ||
      bytes.length !== row.sizeBytes ||
      sniffImageType(bytes) !== row.contentType
    ) {
      continue;
    }
    await storage.put(row.tenantId, row.storageKey, bytes);
    stored += 1;
  }
  return stored;
}
