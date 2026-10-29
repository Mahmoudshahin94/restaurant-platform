/** Releases and rollout (ADR 0026): what the platform publishes and how a tenant follows it. */

type ValueOf<T> = T[keyof T];

/**
 * Where a release is published, and which releases a tenant follows: STABLE ones only, or BETA
 * ones too. A tenant can also be pinned to one version (`TenantReleaseChannel.pinnedVersion`).
 */
export const ReleaseChannel = {
  STABLE: 'STABLE',
  BETA: 'BETA',
} as const;
export type ReleaseChannel = ValueOf<typeof ReleaseChannel>;

/** How a device's reported version compares with its tenant's rollout. */
export const DeviceVersionStatus = {
  /** At or above the version its tenant's channel (or pin) points at. */
  CURRENT: 'CURRENT',
  /** Below its tenant's target version, still supported: update it at the next opportunity. */
  OUTDATED: 'OUTDATED',
  /** Below the cloud's minimum: the cloud refuses it (`HUB_UPGRADE_REQUIRED`/`CLIENT_UPGRADE_REQUIRED`). */
  UNSUPPORTED: 'UNSUPPORTED',
  /** It never reported a version. */
  UNKNOWN: 'UNKNOWN',
} as const;
export type DeviceVersionStatus = ValueOf<typeof DeviceVersionStatus>;
