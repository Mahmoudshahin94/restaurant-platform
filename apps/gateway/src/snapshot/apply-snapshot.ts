import { SNAPSHOT_TABLES, type LocationSnapshot, type SnapshotTable } from '@pos/validation';
import type { HubTx } from '../database/hub-database';

type Row = Record<string, unknown>;

/** Join tables and grants: the snapshot is the complete set, so they are replaced wholesale. */
const REPLACED: ReadonlySet<SnapshotTable> = new Set([
  'rolePermissions',
  'userRoles',
  'productModifierGroups',
  'productStations',
  'productTaxes',
  'locationProducts',
  'tenantEntitlements',
  'featureOverrides',
]);

const DELEGATE: Record<SnapshotTable, string> = {
  tenants: 'tenant',
  locations: 'location',
  devices: 'device',
  roles: 'role',
  rolePermissions: 'rolePermission',
  users: 'user',
  userRoles: 'userRole',
  employees: 'employee',
  taxes: 'tax',
  categories: 'category',
  kitchenStations: 'kitchenStation',
  modifierGroups: 'modifierGroup',
  modifiers: 'modifier',
  products: 'product',
  productVariants: 'productVariant',
  productModifierGroups: 'productModifierGroup',
  productStations: 'productStation',
  productTaxes: 'productTax',
  locationProducts: 'locationProduct',
  discounts: 'discount',
  tableSections: 'tableSection',
  diningTables: 'diningTable',
  paymentMethods: 'paymentMethod',
  cashRegisters: 'cashRegister',
  tenantEntitlements: 'tenantEntitlement',
  featureOverrides: 'featureOverride',
  orderCounters: 'orderCounter',
};

/** Merged rather than copied: the hub's own numbering must never go backwards. */
const MERGED: ReadonlySet<SnapshotTable> = new Set(['orderCounters']);

interface Delegate {
  upsert(args: { where: { id: unknown }; create: Row; update: Row }): Promise<unknown>;
  deleteMany(args?: object): Promise<unknown>;
  createMany(args: { data: Row[] }): Promise<unknown>;
  updateMany(args: { where: object; data: Row }): Promise<unknown>;
}

/**
 * Whether every row of the snapshot belongs to `tenantId` (ADR 0017): the tenant row itself, and
 * each row carrying a `tenantId`. The hub's database holds its paired tenant only.
 */
export function belongsToTenant(snapshot: LocationSnapshot, tenantId: string): boolean {
  if (snapshot.tenantId !== tenantId) return false;
  return SNAPSHOT_TABLES.every((table) =>
    (snapshot.tables[table] as Row[]).every((row) =>
      table === 'tenants' ? row.id === tenantId : !('tenantId' in row) || row.tenantId === tenantId,
    ),
  );
}

/**
 * Writes a cloud snapshot into the hub database (inside the caller's transaction). Rows are
 * upserted in dependency order, so local orders keep referencing the same products, tables and
 * staff. Nothing the cloud owns is ever deleted outright (orders reference it); staff missing from
 * the snapshot are deactivated instead.
 */
export async function applySnapshot(tx: HubTx, snapshot: LocationSnapshot): Promise<number> {
  const delegates = tx as unknown as Record<string, Delegate>;
  // Children first: drop replaced sets before their parents are touched.
  for (const table of [...SNAPSHOT_TABLES].reverse()) {
    if (REPLACED.has(table)) await delegates[DELEGATE[table]]?.deleteMany({});
  }
  let written = 0;
  for (const table of SNAPSHOT_TABLES) {
    const delegate = delegates[DELEGATE[table]];
    if (!delegate) throw new Error(`No hub model for snapshot table ${table}`);
    const rows = snapshot.tables[table] as Row[];
    if (MERGED.has(table)) {
      await mergeOrderCounters(tx, rows);
    } else if (REPLACED.has(table)) {
      if (rows.length > 0) await delegate.createMany({ data: rows });
    } else {
      for (const row of rows) {
        await delegate.upsert({ where: { id: row.id }, create: row, update: row });
      }
    }
    written += rows.length;
  }
  const keep = (table: 'users' | 'employees') => snapshot.tables[table].map((r) => r.id as string);
  await delegates.user?.updateMany({
    where: { id: { notIn: keep('users') } },
    data: { isActive: false },
  });
  await delegates.employee?.updateMany({
    where: { id: { notIn: keep('employees') } },
    data: { isActive: false },
  });
  return written;
}

/**
 * Continues the cloud's order numbers for a business day the cloud already numbered (orders taken
 * before the hub was paired), so hub orders never reuse a number the cloud has: the higher of the
 * two counters wins.
 */
async function mergeOrderCounters(tx: HubTx, rows: Row[]): Promise<void> {
  for (const row of rows) {
    const key = {
      locationId: String(row.locationId),
      businessDate: new Date(String(row.businessDate)),
    };
    const cloud = Number(row.lastNumber);
    const local = await tx.orderCounter.findUnique({ where: { locationId_businessDate: key } });
    if (!local) await tx.orderCounter.create({ data: { ...key, lastNumber: cloud } });
    else if (local.lastNumber < cloud) {
      await tx.orderCounter.update({
        where: { locationId_businessDate: key },
        data: { lastNumber: cloud },
      });
    }
  }
}
