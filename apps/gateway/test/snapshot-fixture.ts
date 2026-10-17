import { createHash } from 'node:crypto';
import { hashSecret } from '@pos/database';
import { newId } from '@pos/domain';
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
  const restaurantId = newId();
  const locationId = newId();
  const ids = {
    restaurantId,
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
    drawer: newId(),
  };
  const passwordHash = await hashSecret(PASSWORD);
  const grants = (roleId: string, keys: readonly string[]) =>
    keys.map((permissionKey) => ({ roleId, permissionKey }));
  const user = (id: string, name: string) => ({
    id,
    restaurantId,
    email: `${name.toLowerCase()}@hub.test`,
    passwordHash,
    displayName: name,
    isActive: true,
  });

  const tables: Record<SnapshotTable, Record<string, unknown>[]> = {
    restaurants: [
      {
        id: restaurantId,
        slug: `hub-test-${restaurantId.slice(-6)}`,
        nameEn: 'Hub Test',
        nameAr: 'اختبار',
        currencyCode: 'SAR',
        timezone: 'Asia/Riyadh',
      },
    ],
    locations: [
      {
        id: locationId,
        restaurantId,
        code: 'MAIN',
        nameEn: 'Main',
        nameAr: 'الرئيسي',
        timezone: 'Asia/Riyadh',
        taxInclusive: true,
      },
    ],
    roles: [
      { id: ids.ownerRole, restaurantId, name: 'Owner', isSystem: true },
      { id: ids.cashierRole, restaurantId, name: 'Cashier' },
      { id: ids.kitchenRole, restaurantId, name: 'Kitchen' },
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
        restaurantId,
        homeLocationId: locationId,
        userId: ids.cashier,
        employeeCode: '1001',
        displayName: 'Cashier',
        pinHash: await hashSecret(CASHIER_PIN),
        isActive: true,
      },
    ],
    taxes: [{ id: ids.vat, restaurantId, nameEn: 'VAT', nameAr: 'ضريبة', rateBps: 1500 }],
    categories: [{ id: ids.category, restaurantId, nameEn: 'Mains', nameAr: 'رئيسية' }],
    kitchenStations: [
      { id: ids.grill, restaurantId, code: 'GRILL', nameEn: 'Grill', nameAr: 'الشواية' },
      { id: ids.fryer, restaurantId, code: 'FRYER', nameEn: 'Fryer', nameAr: 'المقلاة' },
    ],
    modifierGroups: [
      {
        id: ids.doneness,
        restaurantId,
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
        restaurantId,
        categoryId: ids.category,
        nameEn: 'Burger',
        nameAr: 'برجر',
        price: 2500,
      },
      {
        id: ids.fries,
        restaurantId,
        categoryId: ids.category,
        nameEn: 'Fries',
        nameAr: 'بطاطس',
        price: 900,
      },
      {
        id: ids.cola,
        restaurantId,
        categoryId: ids.category,
        nameEn: 'Cola',
        nameAr: 'كولا',
        price: 600,
      },
    ],
    productVariants: [],
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
        restaurantId,
        nameEn: '10% off',
        nameAr: 'خصم',
        type: 'PERCENTAGE',
        value: 1000,
      },
    ],
    tableSections: [{ id: ids.section, locationId, nameEn: 'Indoor', nameAr: 'داخلي' }],
    diningTables: [{ id: ids.t1, locationId, sectionId: ids.section, label: 'T1' }],
    paymentMethods: [
      { id: ids.cash, restaurantId, type: 'CASH', nameEn: 'Cash', nameAr: 'نقدًا' },
      { id: ids.card, restaurantId, type: 'CARD', nameEn: 'Mada', nameAr: 'مدى' },
    ],
    cashRegisters: [{ id: ids.drawer, locationId, nameEn: 'Drawer', nameAr: 'الدرج' }],
    orderCounters: [] as { locationId: string; businessDate: string; lastNumber: number }[],
  };
  return { ids, tables };
}

export function withVersion(
  ids: { restaurantId: string; locationId: string },
  tables: Record<SnapshotTable, Record<string, unknown>[]>,
): LocationSnapshot {
  const json = JSON.parse(JSON.stringify(tables)) as LocationSnapshot['tables'];
  return {
    format: 1,
    restaurantId: ids.restaurantId,
    locationId: ids.locationId,
    generatedAt: new Date().toISOString(),
    version: createHash('sha256').update(JSON.stringify(json)).digest('hex').slice(0, 32),
    tables: json,
  };
}
