import {
  DeviceStatus,
  DeviceType,
  SyncConnectionState,
  TERMINAL_DEVICE_TYPES,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

// --- Devices (cloud) -------------------------------------------------------------------------

export const deviceSchema = z.object({
  id: idSchema,
  locationId: idSchema,
  name: z.string(),
  type: z.enum(enumValues(DeviceType)),
  status: z.enum(enumValues(DeviceStatus)),
  /** Terminals: when the device paired with its location hub (ADR 0022). */
  pairedAt: isoDateTimeSchema.nullable(),
  lastSeenAt: isoDateTimeSchema.nullable(),
  /** The app version the device last reported. */
  appVersion: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type Device = z.infer<typeof deviceSchema>;

export const terminalDeviceTypeSchema = z.enum(TERMINAL_DEVICE_TYPES);

/**
 * Registers a device of a location. A hub (`GATEWAY`) gets its credential at once; a terminal
 * (POS, KDS, kiosk, customer display) waits with a one-time pairing code for its hub (ADR 0022).
 */
export const pairDeviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['GATEWAY', ...TERMINAL_DEVICE_TYPES]),
});
export type PairDeviceRequest = z.input<typeof pairDeviceSchema>;

/** How a terminal pairs: typed on the terminal, checked by the location hub (shown once). */
export const pairingCodeSchema = z.object({
  /** Eight characters, shown as `ABCD-EFGH`. */
  code: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type PairingCode = z.infer<typeof pairingCodeSchema>;

export const pairedDeviceSchema = z.object({
  device: deviceSchema,
  /**
   * Hubs: `<deviceId>.<secret>`, shown once, stored only by the hub. Sent as
   * `Authorization: Device …`. Null for terminals, whose hub issues their credential.
   */
  credential: z.string().nullable(),
  /** Terminals: the code to type on the device. Null for hubs. */
  pairing: pairingCodeSchema.nullable(),
});
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;

// --- Terminals (hub) ---------------------------------------------------------------------------

/** Letters and digits of pairing codes: no 0/O, 1/I/L, so a code read aloud is typed right. */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;

/** What a terminal sends its hub to pair: the admin's code (spaces, dashes and case ignored). */
export const pairTerminalSchema = z.object({
  code: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
    .pipe(
      z
        .string()
        .length(PAIRING_CODE_LENGTH)
        .regex(/^[A-Z0-9]+$/),
    ),
});
export type PairTerminalRequest = z.input<typeof pairTerminalSchema>;

/** The terminal's identity at its hub (no secrets). */
export const terminalSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  locationId: idSchema,
  name: z.string(),
  type: terminalDeviceTypeSchema,
});
export type Terminal = z.infer<typeof terminalSchema>;

export const pairedTerminalSchema = z.object({
  device: terminalSchema,
  /**
   * `<deviceId>.<secret>`: returned once, kept by the terminal (its hub keeps only a hash). Sent as
   * `Authorization: Device …` to the hub.
   */
  credential: z.string(),
});
export type PairedTerminal = z.infer<typeof pairedTerminalSchema>;

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
  /**
   * The location's devices, without credentials: device-level module overrides name them, and a
   * terminal waiting to pair brings the hash of its pairing code (ADR 0022).
   */
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
  /** Retail catalog (ADR 0021): option axes, their values, each variant's values, barcodes. */
  'productOptions',
  'productOptionValues',
  'productVariantOptionValues',
  'productBarcodes',
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
   * modules a hub must enforce, ADR 0018; 4: branding and its files, ADR 0019; 5: options and
   * barcodes, ADR 0021; 6: terminals waiting to pair, ADR 0022).
   */
  format: z.literal(6),
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
