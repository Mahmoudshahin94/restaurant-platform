import { type DeviceVersionStatus, type ReleaseChannel } from '@pos/shared-types';
import { DomainError } from '../errors';

// --- Versions (ADR 0026) ------------------------------------------------------------------------

/** Semantic versioning 2.0 (`1.0.0`, `1.2.0-beta.1`, `1.2.0+42`); the same rule as set-version. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** The longest version a device may report (`devices.app_version`). */
export const MAX_VERSION_LENGTH = 40;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

function parse(version: string): ParsedVersion | null {
  if (version.length > MAX_VERSION_LENGTH) return null;
  const match = SEMVER.exec(version);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isMadarVersion(value: unknown): value is string {
  return typeof value === 'string' && parse(value) !== null;
}

function compareIdentifiers(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Math.sign(Number(a) - Number(b));
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semantic-versioning precedence: -1, 0 or 1. A pre-release sorts before its release
 * (`1.1.0-beta.1` < `1.1.0`); build metadata is ignored. Throws on an invalid version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) throw new Error(`Not a semantic version: ${left ? b : a}`);
  for (let i = 0; i < 3; i += 1) {
    const [l, r] = [left.core[i] ?? 0, right.core[i] ?? 0];
    if (l !== r) return l < r ? -1 : 1;
  }
  const [x, y] = [left.prerelease, right.prerelease];
  if (x.length === 0 || y.length === 0) {
    return x.length === y.length ? 0 : x.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const order = compareIdentifiers(x[i] ?? '', y[i] ?? '');
    if (order !== 0) return order < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** Whether `version` is older than `minimum` (a null minimum: nothing is too old). */
export function isBelow(version: string, minimum: string | null): boolean {
  return minimum !== null && compareVersions(version, minimum) < 0;
}

const highest = (versions: readonly (string | null)[]): string | null =>
  versions.reduce<string | null>(
    (top, v) => (v === null ? top : top === null || compareVersions(v, top) > 0 ? v : top),
    null,
  );

// --- Releases and rollout ------------------------------------------------------------------------

/** What the rules need of a published release. */
export interface ReleaseFacts {
  version: string;
  channel: ReleaseChannel;
  minSupportedHubVersion: string | null;
  minSupportedClientVersion: string | null;
}

/** A tenant's rollout setting: a channel, or a pinned version (which wins). */
export interface RolloutSetting {
  channel: ReleaseChannel;
  pinnedVersion: string | null;
}

/** A tenant nobody placed on a channel follows the stable releases. */
export const DEFAULT_ROLLOUT: RolloutSetting = { channel: 'STABLE', pinnedVersion: null };

export interface SupportedMinimums {
  hub: string | null;
  client: string | null;
}

/**
 * The oldest hub and app the running cloud still serves: the highest minimum declared by any
 * published release up to the cloud's own version, on any channel. A release the cloud does not
 * run yet changes nothing until it is deployed. The cloud is one deployment for every tenant, so
 * a tenant's channel never lowers these: a hub the cloud cannot serve (for example one that does
 * not know the snapshot's newer columns) is refused rather than left to fail.
 */
export function supportedMinimums(
  releases: readonly ReleaseFacts[],
  runningVersion: string,
): SupportedMinimums {
  const deployed = releases.filter((r) => compareVersions(r.version, runningVersion) <= 0);
  return {
    hub: highest(deployed.map((r) => r.minSupportedHubVersion)),
    client: highest(deployed.map((r) => r.minSupportedClientVersion)),
  };
}

/**
 * The version a tenant's devices should run: its pinned version, else the newest published
 * release of its channel (a BETA tenant also takes stable releases). Null when none is published.
 */
export function targetVersion(
  setting: RolloutSetting,
  releases: readonly ReleaseFacts[],
): string | null {
  if (setting.pinnedVersion !== null) return setting.pinnedVersion;
  return highest(
    releases
      .filter((r) => setting.channel === 'BETA' || r.channel === 'STABLE')
      .map((r) => r.version),
  );
}

/**
 * How a device's reported version compares with its tenant's target and the cloud's minimum.
 * A version that is not semantic is UNKNOWN, as is a device that never reported one.
 */
export function deviceVersionStatus(
  version: string | null,
  limits: { target: string | null; minimum: string | null },
): DeviceVersionStatus {
  if (version === null || !isMadarVersion(version)) return 'UNKNOWN';
  if (isBelow(version, limits.minimum)) return 'UNSUPPORTED';
  if (isBelow(version, limits.target)) return 'OUTDATED';
  return 'CURRENT';
}

/**
 * Refuses a hub or an app older than the cloud's minimum (`426`), with the minimum and the
 * reported version in the details so the app can say what to install. A hub must report its
 * version once a minimum exists (one that does not is older than this rule). An app that sends no
 * version (a script, an integration) is let through: the rule protects apps from a cloud they do
 * not understand, it is not access control.
 */
export function assertVersionSupported(
  kind: 'HUB' | 'CLIENT',
  reported: string | null | undefined,
  minimum: string | null,
): void {
  if (minimum === null) return;
  const version = isMadarVersion(reported) ? reported : null;
  if (version === null && kind === 'CLIENT') return;
  if (version === null || isBelow(version, minimum)) {
    throw new DomainError(
      kind === 'HUB' ? 'HUB_UPGRADE_REQUIRED' : 'CLIENT_UPGRADE_REQUIRED',
      kind === 'HUB'
        ? 'This hub is older than the cloud supports; update it'
        : 'This app is older than the cloud supports; update it',
      { minimumVersion: minimum, version },
    );
  }
}
