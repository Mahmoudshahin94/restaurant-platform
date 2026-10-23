import { DomainError } from '@pos/domain';
import type { PrismaTx } from '../../prisma/prisma.service';

/**
 * Verifies that referenced catalog rows exist, belong to the tenant and are not archived.
 * Answers with the specific *_NOT_FOUND code and the offending ids.
 */
export async function assertCategory(
  tx: PrismaTx,
  tenantId: string,
  categoryId: string,
): Promise<void> {
  const found = await tx.category.count({
    where: { id: categoryId, tenantId, archivedAt: null },
  });
  if (found !== 1)
    throw new DomainError('CATEGORY_NOT_FOUND', 'Category not found', { categoryId });
}

export async function assertModifierGroups(
  tx: PrismaTx,
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx.modifierGroup.findMany({
    where: { id: { in: [...ids] }, tenantId, archivedAt: null },
    select: { id: true },
  });
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new DomainError('MODIFIER_GROUP_NOT_FOUND', 'Modifier group not found', {
      modifierGroupIds: missing,
    });
  }
}

export async function assertTaxes(
  tx: PrismaTx,
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx.tax.findMany({
    where: { id: { in: [...ids] }, tenantId, archivedAt: null },
    select: { id: true },
  });
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new DomainError('TAX_NOT_FOUND', 'Tax not found', { taxIds: missing });
}

export async function assertKitchenStations(
  tx: PrismaTx,
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx.kitchenStation.findMany({
    where: { id: { in: [...ids] }, tenantId, archivedAt: null },
    select: { id: true },
  });
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new DomainError('KITCHEN_STATION_NOT_FOUND', 'Kitchen station not found', {
      kitchenStationIds: missing,
    });
  }
}
