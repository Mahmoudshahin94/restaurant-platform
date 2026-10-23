import { DeviceStatus, DeviceType, SyncConnectionState, enumValues } from '@pos/shared-types';
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
  'tenants',
  'locations',
  /** The location's devices, without credentials: device-level module overrides name them. */
  'devices',
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
  /** Modules (ADR 0018): the platform's entitlements and the overrides of this location. */
  'tenantEntitlements',
  'featureOverrides',
  /** Branding (ADR 0019): the files it shows, then the tenant's branding row. */
  'tenantFiles',
  'tenantBranding',
  /** The cloud's order numbers of recent business days: a hub paired mid-day continues them. */
  'orderCounters',
] as const;
export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

export const locationSnapshotSchema = z.object({
  /**
   * Bumped when the snapshot format changes incompatibly (2: the tenant rename, ADR 0017; 3: the
   * modules a hub must enforce, ADR 0018; 4: branding and its files, ADR 0019).
   */
  format: z.literal(4),
  tenantId: idSchema,
  locationId: idSchema,
  generatedAt: isoDateTimeSchema,
  /** Content hash; also the HTTP ETag. */
  version: z.string(),
  tables: z.object(
    Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, rows])) as Record<SnapshotTable, typeof rows>,
  ),
  /**
   * The bytes of every file in `tables.tenantFiles` (base64): the logos and favicons the hub
   * serves offline. Checked against each row's SHA-256 before they are stored.
   */
  files: z.array(z.object({ id: idSchema, content: z.base64() })),
});
export type LocationSnapshot = z.infer<typeof locationSnapshotSchema>;

// --- Hub status (hub → POS/admin) --------------------------------------------------------------

export const hubStatusSchema = z.object({
  paired: z.boolean(),
  tenantId: idSchema.nullable(),
  locationId: idSchema.nullable(),
  /** Whether the last attempt to reach the cloud succeeded. */
  cloud: z.enum(['ONLINE', 'OFFLINE', 'UNKNOWN']),
  /** What the POS shows: SYNC_ERROR > OFFLINE > SYNCING > ONLINE (docs/sync.md). */
  state: z.enum(enumValues(SyncConnectionState)),
  lastSnapshotAt: isoDateTimeSchema.nullable(),
  snapshotVersion: z.string().nullable(),
  lastError: z.string().nullable(),
  /** Outbox rows waiting to be sent (or in flight). */
  pendingOperations: z.int(),
  /** Outbox rows the cloud refused; they wait for someone to retry them. */
  failedOperations: z.int(),
  /** Outbox rows completed in the last 24 hours. */
  syncedOperations: z.int(),
  /** Last successful push or pull. */
  lastSyncAt: isoDateTimeSchema.nullable(),
  /** When the engine tries the cloud again after a failure; null when it is not waiting. */
  nextAttemptAt: isoDateTimeSchema.nullable(),
});
export type HubStatus = z.infer<typeof hubStatusSchema>;
