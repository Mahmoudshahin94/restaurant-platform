import { describe, expect, it } from 'vitest';
import {
  type ReleaseFacts,
  assertVersionSupported,
  compareVersions,
  deviceVersionStatus,
  isBelow,
  isMadarVersion,
  supportedMinimums,
  targetVersion,
} from './index';

const release = (
  version: string,
  channel: ReleaseFacts['channel'] = 'STABLE',
  minimums: { hub?: string; client?: string } = {},
): ReleaseFacts => ({
  version,
  channel,
  minSupportedHubVersion: minimums.hub ?? null,
  minSupportedClientVersion: minimums.client ?? null,
});

/** The code of the DomainError `fn` throws, or null when it does not throw. */
function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'NOT_A_DOMAIN_ERROR';
  }
}

describe('versions (ADR 0026)', () => {
  it('accepts semantic versions only', () => {
    expect(['1.0.0', '1.2.0-beta.1', '1.2.0+42', '0.0.1'].every(isMadarVersion)).toBe(true);
    expect(
      ['1.0', 'v1.0.0', '01.0.0', '', null, `1.0.0-${'a'.repeat(40)}`].some(isMadarVersion),
    ).toBe(false);
  });

  it('orders by semantic-versioning precedence', () => {
    const sorted = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.2.0',
      '1.10.0',
      '2.0.0',
    ];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      expect(compareVersions(sorted[i]!, sorted[i + 1]!), `${sorted[i]} < ${sorted[i + 1]}`).toBe(
        -1,
      );
      expect(compareVersions(sorted[i + 1]!, sorted[i]!)).toBe(1);
    }
    expect(compareVersions('1.0.0+1', '1.0.0+2')).toBe(0);
    expect(() => compareVersions('1.0', '1.0.0')).toThrow(/semantic/);
  });

  it('is below a minimum only when older; no minimum means nothing is', () => {
    expect(isBelow('1.0.0', '1.0.1')).toBe(true);
    expect(isBelow('1.1.0-beta.1', '1.1.0')).toBe(true);
    expect(isBelow('1.1.0', '1.1.0')).toBe(false);
    expect(isBelow('0.0.1', null)).toBe(false);
  });
});

describe('releases and rollout', () => {
  const releases = [
    release('1.0.0', 'STABLE', { hub: '1.0.0', client: '0.9.0' }),
    release('1.1.0', 'STABLE', { client: '1.0.0' }),
    release('1.2.0-beta.1', 'BETA', { hub: '1.2.0-beta.1' }),
  ];

  it('enforces the highest minimum of the releases the cloud runs', () => {
    expect(supportedMinimums(releases, '1.1.0')).toEqual({ hub: '1.0.0', client: '1.0.0' });
    // A release not deployed yet changes nothing.
    expect(supportedMinimums(releases, '1.0.0')).toEqual({ hub: '1.0.0', client: '0.9.0' });
    expect(supportedMinimums(releases, '1.2.0')).toEqual({ hub: '1.2.0-beta.1', client: '1.0.0' });
    expect(supportedMinimums([], '1.0.0')).toEqual({ hub: null, client: null });
  });

  it("points a tenant at its channel's newest release, or its pin", () => {
    expect(targetVersion({ channel: 'STABLE', pinnedVersion: null }, releases)).toBe('1.1.0');
    expect(targetVersion({ channel: 'BETA', pinnedVersion: null }, releases)).toBe('1.2.0-beta.1');
    expect(targetVersion({ channel: 'BETA', pinnedVersion: '1.0.0' }, releases)).toBe('1.0.0');
    expect(targetVersion({ channel: 'STABLE', pinnedVersion: null }, [])).toBeNull();
  });

  it("flags a device against its tenant's target and the cloud's minimum", () => {
    const limits = { target: '1.1.0', minimum: '1.0.0' };
    expect(deviceVersionStatus('1.1.0', limits)).toBe('CURRENT');
    expect(deviceVersionStatus('1.2.0', limits)).toBe('CURRENT');
    expect(deviceVersionStatus('1.0.5', limits)).toBe('OUTDATED');
    expect(deviceVersionStatus('0.9.0', limits)).toBe('UNSUPPORTED');
    expect(deviceVersionStatus(null, limits)).toBe('UNKNOWN');
    expect(deviceVersionStatus('dev-build', limits)).toBe('UNKNOWN');
    expect(deviceVersionStatus('0.1.0', { target: null, minimum: null })).toBe('CURRENT');
  });
});

describe('the minimum-version refusal', () => {
  it('refuses a hub below the minimum, or one that does not say', () => {
    expect(
      codeOf(() => {
        assertVersionSupported('HUB', '0.9.0', '1.0.0');
      }),
    ).toBe('HUB_UPGRADE_REQUIRED');
    expect(
      codeOf(() => {
        assertVersionSupported('HUB', undefined, '1.0.0');
      }),
    ).toBe('HUB_UPGRADE_REQUIRED');
    expect(
      codeOf(() => {
        assertVersionSupported('HUB', '1.0.0', '1.0.0');
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertVersionSupported('HUB', undefined, null);
      }),
    ).toBeNull();
  });

  it('refuses an app below the minimum, with what to install', () => {
    try {
      assertVersionSupported('CLIENT', '0.9.0', '1.0.0');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'CLIENT_UPGRADE_REQUIRED',
        details: { minimumVersion: '1.0.0', version: '0.9.0' },
      });
    }
    expect(
      codeOf(() => {
        assertVersionSupported('CLIENT', '1.0.1', '1.0.0');
      }),
    ).toBeNull();
    // No version (a script): let through.
    expect(
      codeOf(() => {
        assertVersionSupported('CLIENT', undefined, '1.0.0');
      }),
    ).toBeNull();
  });
});
