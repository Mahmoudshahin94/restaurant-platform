import { PERMISSIONS, type Permission } from '@pos/shared-types';

/** How the role matrix groups the permission catalog (every key appears exactly once). */
export const PERMISSION_GROUPS = [
  { key: 'orders', prefixes: ['orders.'] },
  { key: 'products', prefixes: ['products.'] },
  { key: 'payments', prefixes: ['payments.', 'shifts.', 'cash.', 'kiosk.'] },
  { key: 'kitchen', prefixes: ['kitchen.', 'tables.'] },
  { key: 'people', prefixes: ['customers.', 'reports.', 'users.', 'roles.'] },
  {
    key: 'settings',
    prefixes: [
      'locations.',
      'settings.',
      'online_ordering.',
      'website.',
      'devices.',
      'sync.',
      'audit.',
    ],
  },
] as const;

export type PermissionGroupKey = (typeof PERMISSION_GROUPS)[number]['key'];

export function permissionsOf(group: (typeof PERMISSION_GROUPS)[number]): Permission[] {
  return PERMISSIONS.filter((p) => group.prefixes.some((prefix) => p.startsWith(prefix)));
}
