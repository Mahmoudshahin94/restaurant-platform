import { createHash } from 'node:crypto';
import { hashSecret } from '@pos/database';
import { newId } from '@pos/domain';
import { hashPairingCode } from '@pos/server';
import { PERMISSIONS } from '@pos/shared-types';
import type { LocationSnapshot, SnapshotTable } from '@pos/validation';

export const PASSWORD = 'Test-Password-1';
export const CASHIER_PIN = '2468';

/**
 * A complete location as the cloud would send it: three staff roles, a cashier with a PIN, a
 * menu across two stations, tables, payment methods and a drawer. Tests mutate `tables` and call
 * `withVersion` to simulate cloud-side changes.
 */
export async function buildSnapshot() {
  const tenantId = newId();
  const locationId = newId();
  const ids = {
    tenantId,
    locationId,
    ownerRole: newId(),
    cashierRole: newId(),
    kitchenRole: newId(),
    owner: newId(),
    cashier: newId(),
    kitchen: newId(),
    employee: newId(),
    vat: newId(),
    category: newId(),
    grill: newId(),
    fryer: newId(),
    doneness: newId(),
    medium: newId(),
    burger: newId(),
    fries: newId(),
    cola: newId(),
    tenPercent: newId(),
    section: newId(),
    t1: newId(),
    cash: newId(),
    card: newId(),
    online: newId(),
    drawer: newId(),
  };
  const passwordHash = await hashSecret(PASSWORD);
  const grants = (roleId: string, keys: readonly string[]) =>
    keys.map((permissionKey) => ({ roleId, permissionKey }));
  const user = (id: string, name: string) => ({
    id,
    tenantId,
    email: `${name.toLowerCase()}@hub.test`,
    passwordHash,
    displayName: name,
    isActive: true,
  });

  const tables: Record<SnapshotTable, Record<string, unknown>[]> = {
    tenants: [
      {
        id: tenantId,
        slug: `hub-test-${tenantId.slice(-6)}`,
        nameEn: 'Hub Test',
        nameAr: 'اختبار',
        currencyCode: 'SAR',
        timezone: 'Asia/Riyadh',
      },
    ],
    locations: [
      {
        id: locationId,
        tenantId,
        code: 'MAIN',
        nameEn: 'Main',
        nameAr: 'الرئيسي',
        timezone: 'Asia/Riyadh',
        taxInclusive: true,
      },
    ],
    devices: [] as Record<string, unknown>[],
    roles: [
      { id: ids.ownerRole, tenantId, name: 'Owner', isSystem: true },
      { id: ids.cashierRole, tenantId, name: 'Cashier' },
      { id: ids.kitchenRole, tenantId, name: 'Kitchen' },
    ],
    rolePermissions: [
      ...grants(ids.ownerRole, PERMISSIONS),
      ...grants(ids.cashierRole, [
        'orders.view',
        'orders.create',
        'orders.update',
        'payments.create',
        'shifts.manage',
        'locations.view',
        'products.view',
      ]),
      ...grants(ids.kitchenRole, ['kitchen.view', 'kitchen.update', 'locations.view']),
    ],
    users: [user(ids.owner, 'Owner'), user(ids.cashier, 'Cashier'), user(ids.kitchen, 'Kitchen')],
    userRoles: [
      { id: newId(), userId: ids.owner, roleId: ids.ownerRole, locationId: null },
      { id: newId(), userId: ids.cashier, roleId: ids.cashierRole, locationId },
      { id: newId(), userId: ids.kitchen, roleId: ids.kitchenRole, locationId },
    ],
    employees: [
      {
        id: ids.employee,
        tenantId,
        homeLocationId: locationId,
        userId: ids.cashier,
        employeeCode: '1001',
        displayName: 'Cashier',
        pinHash: await hashSecret(CASHIER_PIN),
        isActive: true,
      },
    ],
    taxes: [{ id: ids.vat, tenantId, nameEn: 'VAT', nameAr: 'ضريبة', rateBps: 1500 }],
    categories: [{ id: ids.category, tenantId, nameEn: 'Mains', nameAr: 'رئيسية' }],
    kitchenStations: [
      { id: ids.grill, tenantId, code: 'GRILL', nameEn: 'Grill', nameAr: 'الشواية' },
      { id: ids.fryer, tenantId, code: 'FRYER', nameEn: 'Fryer', nameAr: 'المقلاة' },
    ],
    modifierGroups: [
      {
        id: ids.doneness,
        tenantId,
        nameEn: 'Doneness',
        nameAr: 'الاستواء',
        minSelect: 1,
        maxSelect: 1,
      },
    ],
    modifiers: [
      { id: ids.medium, modifierGroupId: ids.doneness, nameEn: 'Medium', nameAr: 'متوسط' },
    ],
    products: [
      {
        id: ids.burger,
        tenantId,
        categoryId: ids.category,
        nameEn: 'Burger',
        nameAr: 'برجر',
        price: 2500,
      },
      {
        id: ids.fries,
        tenantId,
        categoryId: ids.category,
        nameEn: 'Fries',
        nameAr: 'بطاطس',
        price: 900,
      },
      {
        id: ids.cola,
        tenantId,
        categoryId: ids.category,
        nameEn: 'Cola',
        nameAr: 'كولا',
        price: 600,
      },
    ],
    productVariants: [] as Record<string, unknown>[],
    productOptions: [] as Record<string, unknown>[],
    productOptionValues: [] as Record<string, unknown>[],
    productVariantOptionValues: [] as Record<string, unknown>[],
    productBarcodes: [] as Record<string, unknown>[],
    productModifierGroups: [{ productId: ids.burger, modifierGroupId: ids.doneness, sortOrder: 0 }],
    productStations: [
      { productId: ids.burger, kitchenStationId: ids.grill },
      { productId: ids.fries, kitchenStationId: ids.fryer },
    ],
    productTaxes: [
      { productId: ids.burger, taxId: ids.vat },
      { productId: ids.fries, taxId: ids.vat },
      { productId: ids.cola, taxId: ids.vat },
    ],
    locationProducts: [],
    discounts: [
      {
        id: ids.tenPercent,
        tenantId,
        nameEn: '10% off',
        nameAr: 'خصم',
        type: 'PERCENTAGE',
        value: 1000,
      },
    ],
    tableSections: [{ id: ids.section, locationId, nameEn: 'Indoor', nameAr: 'داخلي' }],
    diningTables: [{ id: ids.t1, locationId, sectionId: ids.section, label: 'T1' }],
    paymentMethods: [
      { id: ids.cash, tenantId, type: 'CASH', nameEn: 'Cash', nameAr: 'نقدًا' },
      { id: ids.card, tenantId, type: 'CARD', nameEn: 'Mada', nameAr: 'مدى' },
      { id: ids.online, tenantId, type: 'ONLINE', nameEn: 'Online card', nameAr: 'بطاقة' },
    ],
    cashRegisters: [{ id: ids.drawer, locationId, nameEn: 'Drawer', nameAr: 'الدرج' }],
    tenantEntitlements: [] as Record<string, unknown>[],
    featureOverrides: [] as Record<string, unknown>[],
    tenantFiles: [] as Record<string, unknown>[],
    tenantBranding: [] as Record<string, unknown>[],
    orderCounters: [] as { locationId: string; businessDate: string; lastNumber: number }[],
  };
  return { ids, tables };
}

/** A code the admin showed for a terminal (normalized: what `pairTerminalSchema` makes of input). */
export const KIOSK_CODE = 'KSKABC23';

/**
 * A terminal created in the admin and waiting to pair (ADR 0022), as the snapshot carries it: its
 * pairing code's hash and expiry, never a credential.
 */
export function pendingTerminal(
  ids: { tenantId: string; locationId: string },
  { code = KIOSK_CODE, type = 'KIOSK', name = 'Kiosk 1', expiresInMs = 60 * 60_000 } = {},
): Record<string, unknown> {
  return {
    id: newId(),
    tenantId: ids.tenantId,
    locationId: ids.locationId,
    name,
    type,
    status: 'PENDING',
    pairingCodeHash: hashPairingCode(code),
    pairingExpiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    createdAt: new Date().toISOString(),
  };
}

/** A tenant-wide module switch (ADR 0018), or one device's. */
export function moduleOverride(
  ids: { tenantId: string; locationId: string },
  feature: string,
  enabled: boolean,
  deviceId: string | null = null,
): Record<string, unknown> {
  return {
    id: newId(),
    tenantId: ids.tenantId,
    locationId: deviceId ? ids.locationId : null,
    deviceId,
    scope: deviceId ? `device:${deviceId}` : 'tenant',
    feature,
    enabled,
  };
}

export function withVersion(
  ids: { tenantId: string; locationId: string },
  tables: Record<SnapshotTable, Record<string, unknown>[]>,
  files: LocationSnapshot['files'] = [],
): LocationSnapshot {
  const json = JSON.parse(JSON.stringify(tables)) as LocationSnapshot['tables'];
  return {
    format: 6,
    tenantId: ids.tenantId,
    locationId: ids.locationId,
    generatedAt: new Date().toISOString(),
    version: createHash('sha256').update(JSON.stringify(json)).digest('hex').slice(0, 32),
    tables: json,
    files,
  };
}
