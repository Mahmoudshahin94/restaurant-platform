import { isMadarVersion } from '@pos/domain';
import {
  DeviceStatus,
  DeviceType,
  DeviceVersionStatus,
  ReleaseChannel,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Releases and rollout (ADR 0026), for the platform admin: the releases MADAR published, the
 * channel each tenant follows, and the versions its devices report.
 */

/** A semantic version (`1.0.0`, `1.2.0-beta.1`, `1.2.0+42`), at most 40 characters. */
export const madarVersionSchema = z
  .string()
  .trim()
  .refine((value) => isMadarVersion(value), { message: 'Not a semantic version' });

export const releaseChannelSchema = z.enum(enumValues(ReleaseChannel));
export const deviceVersionStatusSchema = z.enum(enumValues(DeviceVersionStatus));

export const releaseSchema = z.object({
  id: idSchema,
  version: z.string(),
  channel: releaseChannelSchema,
  notes: z.string(),
  publishedAt: isoDateTimeSchema,
  minSupportedHubVersion: z.string().nullable(),
  minSupportedClientVersion: z.string().nullable(),
  publishedById: idSchema.nullable(),
  publishedByName: z.string().nullable(),
});
export type ReleaseDto = z.infer<typeof releaseSchema>;

/** The oldest hub and app the running cloud serves (null: no minimum). */
export const supportedMinimumsSchema = z.object({
  hub: z.string().nullable(),
  client: z.string().nullable(),
});

export const releasesOverviewSchema = z.object({
  /** The MADAR version the cloud runs. */
  cloudVersion: z.string(),
  /** The highest minimums of the published releases up to `cloudVersion`. */
  minimums: supportedMinimumsSchema,
  /** The newest release of each channel. */
  latest: z.object({ STABLE: z.string().nullable(), BETA: z.string().nullable() }),
  /** Newest first. */
  releases: z.array(releaseSchema),
});
export type ReleasesOverview = z.infer<typeof releasesOverviewSchema>;

const minimum = madarVersionSchema.nullable().optional();
const notes = z.string().trim().max(4000);

/**
 * A minimum above the release's own version would refuse the very hubs and apps it ships, so it is
 * refused (compared with semantic-versioning precedence by the service).
 */
export const publishReleaseSchema = z.object({
  version: madarVersionSchema,
  channel: releaseChannelSchema,
  notes: notes.default(''),
  minSupportedHubVersion: minimum,
  minSupportedClientVersion: minimum,
});
export type PublishReleaseRequest = z.input<typeof publishReleaseSchema>;

/** Corrects a published release: its notes, its channel (promote a beta) or its minimums. */
export const updateReleaseSchema = z
  .object({
    channel: releaseChannelSchema.optional(),
    notes: notes.optional(),
    minSupportedHubVersion: minimum,
    minSupportedClientVersion: minimum,
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Nothing to change',
  });
export type UpdateReleaseRequest = z.input<typeof updateReleaseSchema>;

// --- Rollout -------------------------------------------------------------------------------------

export const tenantRolloutSchema = z.object({
  tenantId: idSchema,
  channel: releaseChannelSchema,
  pinnedVersion: z.string().nullable(),
  /** The version the tenant's devices should run: the pin, else its channel's newest release. */
  targetVersion: z.string().nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
});
export type TenantRollout = z.infer<typeof tenantRolloutSchema>;

export const setTenantRolloutSchema = z.object({
  channel: releaseChannelSchema,
  /** A published release's version; null follows the channel. */
  pinnedVersion: madarVersionSchema.nullable().default(null),
  reason: z.string().trim().min(5).max(500),
});
export type SetTenantRolloutRequest = z.input<typeof setTenantRolloutSchema>;

// --- Device versions -----------------------------------------------------------------------------

export const deviceVersionSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  locationId: idSchema,
  locationCode: z.string(),
  name: z.string(),
  type: z.enum(enumValues(DeviceType)),
  status: z.enum(enumValues(DeviceStatus)),
  appVersion: z.string().nullable(),
  /** When the device first reported `appVersion`. */
  lastVersionAt: isoDateTimeSchema.nullable(),
  lastSeenAt: isoDateTimeSchema.nullable(),
  online: z.boolean(),
  versionStatus: deviceVersionStatusSchema,
});
export type DeviceVersion = z.infer<typeof deviceVersionSchema>;

export const tenantDeviceVersionsSchema = z.object({
  tenantId: idSchema,
  slug: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  channel: releaseChannelSchema,
  pinnedVersion: z.string().nullable(),
  targetVersion: z.string().nullable(),
  /** Below the tenant's target (still supported). */
  outdated: z.int(),
  /** Below the cloud's minimum: refused until updated. */
  unsupported: z.int(),
  devices: z.array(deviceVersionSchema),
});
export type TenantDeviceVersions = z.infer<typeof tenantDeviceVersionsSchema>;

export const deviceVersionsQuerySchema = z.object({
  tenantId: idSchema.optional(),
  /** Only devices below their tenant's target or the cloud's minimum (and their tenants). */
  outdatedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type DeviceVersionsQuery = z.input<typeof deviceVersionsQuerySchema>;

export const deviceVersionsSchema = z.object({
  generatedAt: isoDateTimeSchema,
  cloudVersion: z.string(),
  minimums: supportedMinimumsSchema,
  tenants: z.array(tenantDeviceVersionsSchema),
});
export type DeviceVersions = z.infer<typeof deviceVersionsSchema>;
