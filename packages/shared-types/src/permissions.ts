/**
 * The permission catalog. Roles are configurable per tenant, but the set of permission
 * keys is defined in code because every key is enforced by a server-side guard.
 */
export const PERMISSIONS = [
  'orders.view',
  'orders.create',
  'orders.update',
  'orders.cancel',
  'orders.refund',
  'orders.discount',
  'products.view',
  'products.create',
  'products.update',
  'products.delete',
  'payments.view',
  'payments.create',
  'payments.refund',
  'shifts.manage',
  'cash.manage',
  'tables.manage',
  'kitchen.view',
  'kitchen.update',
  'customers.view',
  'customers.manage',
  'reports.view',
  'users.manage',
  'roles.manage',
  'locations.view',
  'settings.manage',
  'online_ordering.manage',
  'devices.manage',
  /** Leave a self-service kiosk's customer screens with a PIN (ADR 0022). */
  'kiosk.attend',
  'sync.view',
  'sync.resolve',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
