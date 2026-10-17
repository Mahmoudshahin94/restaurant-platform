import { DeviceStatus, DeviceType, enumValues } from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

// --- Devices (cloud) -------------------------------------------------------------------------

export const deviceSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  name: z.string(),
  type: z.enum(enumValues(DeviceType)),
  status: z.enum(enumValues(DeviceStatus)),
  lastSeenAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Device = z.infer<typeof deviceSchema>;

/** Registers a location hub. Only GATEWAY devices authenticate with a credential today. */
export const pairDeviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.literal('GATEWAY'),
});
export type PairDeviceRequest = z.input<typeof pairDeviceSchema>;

export const pairedDeviceSchema = z.object({
  device: deviceSchema,
  /** `<deviceId>.<secret>`: shown once, stored only by the hub. Sent as `Authorization: Device …`. */
  credential: z.string(),
});
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;

// --- Location snapshot (cloud → hub) ---------------------------------------------------------

const rows = z.array(z.record(z.string(), z.unknown()));

/**
 * Everything a hub needs to run its location without the cloud: configuration, catalog, floor,
 * staff and their credential hashes. Rows are database rows (dates as ISO strings) and are applied
 * to the hub's mirror of the same schema, in the order listed. Cloud-authoritative: the hub never
 * edits these tables itself.
 */
export const SNAPSHOT_TABLES = [
  'restaurants',
  'locations',
  'roles',
  'rolePermissions',
  'users',
  'userRoles',
  'employees',
  'taxes',
  'categories',
  'kitchenStations',
  'modifierGroups',
  'modifiers',
  'products',
  'productVariants',
  'productModifierGroups',
  'productStations',
  'productTaxes',
  'locationProducts',
  'discounts',
  'tableSections',
  'diningTables',
  'paymentMethods',
  'cashRegisters',
] as const;
export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

export const locationSnapshotSchema = z.object({
  /** Bumped when the snapshot format changes incompatibly. */
  format: z.literal(1),
  restaurantId: idSchema,
  locationId: idSchema,
  generatedAt: isoDateTimeSchema,
  /** Content hash; also the HTTP ETag. */
  version: z.string(),
  tables: z.object(
    Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, rows])) as Record<SnapshotTable, typeof rows>,
  ),
});
export type LocationSnapshot = z.infer<typeof locationSnapshotSchema>;

// --- Hub status (hub → POS/admin) --------------------------------------------------------------

export const hubStatusSchema = z.object({
  paired: z.boolean(),
  restaurantId: idSchema.nullable(),
  locationId: idSchema.nullable(),
  /** Whether the last attempt to reach the cloud succeeded. */
  cloud: z.enum(['ONLINE', 'OFFLINE', 'UNKNOWN']),
  lastSnapshotAt: isoDateTimeSchema.nullable(),
  snapshotVersion: z.string().nullable(),
  lastError: z.string().nullable(),
  /** Outbox rows waiting for the sync engine (Phase 6). */
  pendingOperations: z.int(),
});
export type HubStatus = z.infer<typeof hubStatusSchema>;
