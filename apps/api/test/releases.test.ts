import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type PrismaClient, hashSecret } from '@pos/database';
import { type ApiErrorBody, MADAR_VERSION, type PlatformRole } from '@pos/shared-types';
import type {
  AuditLogEntry,
  DeviceVersions,
  HealthBoard,
  Paginated,
  PairedDevice,
  PlatformTokenResponse,
  ReleaseDto,
  ReleasesOverview,
  TenantRollout,
} from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReleasePolicyService } from '../src/modules/releases/release-policy.service';
import {
  PASSWORD,
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';

/**
 * One MADAR version and its releases (ADR 0026): `/health` says which version runs, hubs and
 * terminals report theirs, the cloud refuses hubs and apps older than the releases it runs
 * allow, and only the platform publishes releases and moves tenants between channels.
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;

const P = '/api/v1/platform';
const VERSION = 'x-madar-client-version';
/** A version older than the one this build is, and one newer. */
const [major] = MADAR_VERSION.split('.').map(Number) as [number];
const OLD = '0.9.0';
const NEXT = `${String(major + 1)}.0.0`;

beforeAll(async () => {
  ({ app, prisma } = await startApp());
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  // The releases were emptied under the cached policy.
  app.get(ReleasePolicyService).invalidate();
  tenant = await createTenant(prisma);
  owner = bearer(await login(app, tenant.owner.email));
});

let counter = 0;
async function platform(role: PlatformRole): Promise<Record<string, string>> {
  counter += 1;
  const user = await prisma.platformUser.create({
    data: {
      email: `${role.toLowerCase()}-${String(counter)}@releases.test`,
      displayName: `Platform ${role}`,
      role,
      passwordHash: await hashSecret('Platform-Password-1'),
    },
  });
  const res = await app.inject({
    method: 'POST',
    url: `${P}/auth/login`,
    payload: { email: user.email, password: 'Platform-Password-1' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return bearer(res.json<PlatformTokenResponse>().accessToken);
}

async function publish(
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<ReleaseDto> {
  const res = await app.inject({ method: 'POST', url: `${P}/releases`, headers, payload: body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<ReleaseDto>();
}

async function pairHub(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/locations/${tenant.locationA}/devices`,
    headers: owner,
    payload: { name: 'Main hub', type: 'GATEWAY' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<PairedDevice & { credential: string }>().credential;
}

const snapshot = (credential: string, version?: string) =>
  app.inject({
    method: 'GET',
    url: '/api/v1/sync/snapshot',
    headers: { authorization: `Device ${credential}`, ...(version ? { [VERSION]: version } : {}) },
  });

describe('one version (ADR 0026)', () => {
  it('answers the version on /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok', version: MADAR_VERSION });
    expect(MADAR_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("a hub's version", () => {
  it('is recorded on its device with when it first reported it', async () => {
    const credential = await pairHub();
    const [deviceId] = credential.split('.') as [string];
    expect((await snapshot(credential, MADAR_VERSION)).statusCode).toBe(200);
    const first = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(first.appVersion).toBe(MADAR_VERSION);
    expect(first.lastVersionAt).toBeInstanceOf(Date);

    // The same version again keeps the date; a new one moves it.
    await snapshot(credential, MADAR_VERSION);
    expect(
      (await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).lastVersionAt,
    ).toEqual(first.lastVersionAt);
    await snapshot(credential, NEXT);
    const updated = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(updated.appVersion).toBe(NEXT);
    expect(updated.lastVersionAt?.getTime()).toBeGreaterThanOrEqual(
      first.lastVersionAt?.getTime() ?? 0,
    );
    // Something that is not a semantic version is never stored.
    await snapshot(credential, 'dev build <script>');
    expect((await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).appVersion).toBe(
      NEXT,
    );
  });

  it('below the minimum is refused (426), still recorded, and back once updated', async () => {
    const credential = await pairHub();
    const [deviceId] = credential.split('.') as [string];
    expect((await snapshot(credential, OLD)).statusCode).toBe(200);

    await publish(await platform('OWNER'), {
      version: MADAR_VERSION,
      channel: 'STABLE',
      minSupportedHubVersion: MADAR_VERSION,
    });
    const refused = await snapshot(credential, OLD);
    expect(refused.statusCode).toBe(426);
    expect(refused.json<ApiErrorBody>()).toMatchObject({
      code: 'HUB_UPGRADE_REQUIRED',
      details: { minimumVersion: MADAR_VERSION, version: OLD },
    });
    // Push and pull are refused the same way: nothing reaches a hub that cannot read it.
    for (const url of ['/api/v1/sync/pull?wait=0', '/api/v1/sync/push']) {
      const res = await app.inject({
        method: url.endsWith('push') ? 'POST' : 'GET',
        url,
        headers: { authorization: `Device ${credential}`, [VERSION]: OLD },
        ...(url.endsWith('push') ? { payload: { operations: [] } } : {}),
      });
      expect(res.statusCode, url).toBe(426);
    }
    // A hub that does not say which version it runs is older than this rule.
    expect((await snapshot(credential)).statusCode).toBe(426);
    expect((await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })).appVersion).toBe(
      OLD,
    );

    // Updated: served again.
    expect((await snapshot(credential, MADAR_VERSION)).statusCode).toBe(200);
  });

  it('is not held to a minimum of a release the cloud does not run yet', async () => {
    const credential = await pairHub();
    await publish(await platform('OWNER'), {
      version: NEXT,
      channel: 'BETA',
      minSupportedHubVersion: NEXT,
      minSupportedClientVersion: NEXT,
    });
    expect((await snapshot(credential, MADAR_VERSION)).statusCode).toBe(200);
  });
});

describe("an app's version", () => {
  const signIn = (version?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: version ? { [VERSION]: version } : {},
      payload: { email: tenant.owner.email, password: PASSWORD },
    });

  it('below the minimum is refused with what to install; others are served', async () => {
    const operator = await platform('OWNER');
    await publish(operator, {
      version: MADAR_VERSION,
      channel: 'STABLE',
      minSupportedClientVersion: MADAR_VERSION,
    });
    const refused = await signIn(OLD);
    expect(refused.statusCode).toBe(426);
    expect(refused.json<ApiErrorBody>()).toMatchObject({
      code: 'CLIENT_UPGRADE_REQUIRED',
      details: { minimumVersion: MADAR_VERSION, version: OLD },
    });
    // Every route, signed in or not.
    const orders = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/orders`,
      headers: { ...owner, [VERSION]: OLD },
    });
    expect(orders.statusCode).toBe(426);
    expect((await signIn(MADAR_VERSION)).statusCode).toBe(200);
    // A caller that reports no version (a script) is served.
    expect((await signIn()).statusCode).toBe(200);

    // The platform's own routes never refuse an operator: a wrong minimum can be corrected.
    const releases = await app.inject({
      method: 'GET',
      url: `${P}/releases`,
      headers: { ...operator, [VERSION]: OLD },
    });
    expect(releases.statusCode).toBe(200);
  });
});

describe('publishing releases', () => {
  it('lists releases newest first with the minimums the cloud enforces', async () => {
    const operator = await platform('OPERATOR');
    await publish(operator, {
      version: '0.8.0',
      channel: 'STABLE',
      minSupportedHubVersion: '0.8.0',
    });
    await publish(operator, {
      version: MADAR_VERSION,
      channel: 'STABLE',
      notes: 'MADAR 1.0',
      minSupportedClientVersion: '0.9.0',
    });
    await publish(operator, { version: NEXT, channel: 'BETA', minSupportedHubVersion: NEXT });
    const res = await app.inject({ method: 'GET', url: `${P}/releases`, headers: operator });
    expect(res.statusCode).toBe(200);
    const overview = res.json<ReleasesOverview>();
    expect(overview.releases.map((r) => r.version)).toEqual([NEXT, MADAR_VERSION, '0.8.0']);
    expect(overview).toMatchObject({
      cloudVersion: MADAR_VERSION,
      minimums: { hub: '0.8.0', client: '0.9.0' },
      latest: { STABLE: MADAR_VERSION, BETA: NEXT },
    });
    expect(overview.releases[1]).toMatchObject({
      notes: 'MADAR 1.0',
      publishedByName: 'Platform OPERATOR',
    });
    expect(await prisma.platformAuditLog.count({ where: { action: 'release.published' } })).toBe(3);
  });

  it('refuses a duplicate version, a minimum above its release and a non-semantic version', async () => {
    const operator = await platform('OWNER');
    await publish(operator, { version: MADAR_VERSION, channel: 'STABLE' });
    const again = await app.inject({
      method: 'POST',
      url: `${P}/releases`,
      headers: operator,
      payload: { version: MADAR_VERSION, channel: 'BETA' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<ApiErrorBody>().details).toMatchObject({ reason: 'VERSION_TAKEN' });
    for (const payload of [
      { version: '1.1.0', channel: 'STABLE', minSupportedHubVersion: '1.2.0' },
      { version: 'v2', channel: 'STABLE' },
      { version: '1.1.0', channel: 'NIGHTLY' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `${P}/releases`,
        headers: operator,
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('corrects a release, audited with before and after, and the rule follows at once', async () => {
    const operator = await platform('OWNER');
    const credential = await pairHub();
    const release = await publish(operator, {
      version: MADAR_VERSION,
      channel: 'STABLE',
      minSupportedHubVersion: MADAR_VERSION,
    });
    expect((await snapshot(credential, OLD)).statusCode).toBe(426);
    const res = await app.inject({
      method: 'PATCH',
      url: `${P}/releases/${release.id}`,
      headers: operator,
      payload: { minSupportedHubVersion: null, notes: 'Hub minimum lifted' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<ReleaseDto>()).toMatchObject({ minSupportedHubVersion: null });
    expect((await snapshot(credential, OLD)).statusCode).toBe(200);
    const audit = await prisma.platformAuditLog.findFirstOrThrow({
      where: { action: 'release.updated' },
    });
    expect(audit.metadata).toMatchObject({
      before: { minSupportedHubVersion: MADAR_VERSION },
      after: { minSupportedHubVersion: null, notes: 'Hub minimum lifted' },
    });
  });
});

describe('release channels', () => {
  const channelUrl = () => `${P}/tenants/${tenant.tenantId}/release-channel`;

  it('only the platform puts a tenant on a channel; SUPPORT and VIEWER only look', async () => {
    const support = await platform('SUPPORT');
    const viewer = await platform('VIEWER');
    const payload = { channel: 'BETA', reason: 'Pilot site' };
    for (const headers of [support, viewer]) {
      expect((await app.inject({ method: 'GET', url: channelUrl(), headers })).statusCode).toBe(
        200,
      );
      expect((await app.inject({ method: 'GET', url: `${P}/releases`, headers })).statusCode).toBe(
        200,
      );
      const put = await app.inject({ method: 'PUT', url: channelUrl(), headers, payload });
      expect(put.statusCode).toBe(403);
      const post = await app.inject({
        method: 'POST',
        url: `${P}/releases`,
        headers,
        payload: { version: NEXT, channel: 'BETA' },
      });
      expect(post.statusCode).toBe(403);
    }
    // The tenant's own staff and anonymous callers never reach these routes.
    for (const headers of [owner, {}]) {
      const put = await app.inject({ method: 'PUT', url: channelUrl(), headers, payload });
      expect(put.statusCode).toBe(401);
    }
    expect(await prisma.tenantReleaseChannel.count()).toBe(0);
  });

  it('moves a tenant to BETA or pins it, with a reason in both audit logs', async () => {
    const operator = await platform('OPERATOR');
    await publish(operator, { version: MADAR_VERSION, channel: 'STABLE' });
    await publish(operator, { version: NEXT, channel: 'BETA' });
    const initial = await app.inject({ method: 'GET', url: channelUrl(), headers: operator });
    expect(initial.json<TenantRollout>()).toMatchObject({
      channel: 'STABLE',
      pinnedVersion: null,
      targetVersion: MADAR_VERSION,
      updatedAt: null,
    });

    const beta = await app.inject({
      method: 'PUT',
      url: channelUrl(),
      headers: operator,
      payload: { channel: 'BETA', reason: 'Pilot site for the next version' },
    });
    expect(beta.statusCode, beta.body).toBe(200);
    expect(beta.json<TenantRollout>()).toMatchObject({ channel: 'BETA', targetVersion: NEXT });

    const pinned = await app.inject({
      method: 'PUT',
      url: channelUrl(),
      headers: operator,
      payload: { channel: 'BETA', pinnedVersion: MADAR_VERSION, reason: 'Hold during Ramadan' },
    });
    expect(pinned.json<TenantRollout>()).toMatchObject({
      pinnedVersion: MADAR_VERSION,
      targetVersion: MADAR_VERSION,
    });

    const tenantLog = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/tenants/${tenant.tenantId}/audit-logs?action=release_channel.changed`,
        headers: owner,
      })
    ).json<Paginated<AuditLogEntry>>();
    expect(tenantLog.items).toHaveLength(2);
    expect(tenantLog.items[0]?.metadata).toMatchObject({
      reason: 'Hold during Ramadan',
      after: { channel: 'BETA', pinnedVersion: MADAR_VERSION },
    });
    expect(
      await prisma.platformAuditLog.count({
        where: { action: 'tenant.release_channel_changed', subjectTenantId: tenant.tenantId },
      }),
    ).toBe(2);
  });

  it('refuses a pin to a version never published, and a change without a reason', async () => {
    const operator = await platform('OWNER');
    const unknown = await app.inject({
      method: 'PUT',
      url: channelUrl(),
      headers: operator,
      payload: { channel: 'STABLE', pinnedVersion: '9.9.9', reason: 'Pin it' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ApiErrorBody>().code).toBe('RELEASE_NOT_FOUND');
    const noReason = await app.inject({
      method: 'PUT',
      url: channelUrl(),
      headers: operator,
      payload: { channel: 'BETA' },
    });
    expect(noReason.statusCode).toBe(400);
  });
});

describe('device versions', () => {
  it('flags devices below their tenant’s target or the cloud’s minimum', async () => {
    const operator = await platform('OWNER');
    const credential = await pairHub();
    const [hubId] = credential.split('.') as [string];
    await snapshot(credential, OLD);
    // Two terminals reported by the hub: one up to date, one a version behind.
    const kioskOf = async (name: string, appVersion: string) =>
      prisma.device.create({
        data: {
          tenantId: tenant.tenantId,
          locationId: tenant.locationA,
          name,
          type: 'KIOSK',
          status: 'ACTIVE',
          appVersion,
          lastVersionAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
    await kioskOf('Kiosk 1', NEXT);
    await kioskOf('Kiosk 2', MADAR_VERSION);
    await publish(operator, {
      version: MADAR_VERSION,
      channel: 'STABLE',
      minSupportedHubVersion: MADAR_VERSION,
    });
    await publish(operator, { version: NEXT, channel: 'STABLE' });

    const res = await app.inject({ method: 'GET', url: `${P}/device-versions`, headers: operator });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = res.json<DeviceVersions>().tenants;
    expect(row).toMatchObject({ targetVersion: NEXT, outdated: 1, unsupported: 1 });
    const status = Object.fromEntries(row?.devices.map((d) => [d.name, d.versionStatus]) ?? []);
    expect(status).toEqual({
      'Main hub': 'UNSUPPORTED',
      'Kiosk 1': 'CURRENT',
      'Kiosk 2': 'OUTDATED',
    });
    expect(row?.devices.find((d) => d.id === hubId)).toMatchObject({
      appVersion: OLD,
      locationCode: expect.any(String) as string,
    });

    const outdated = await app.inject({
      method: 'GET',
      url: `${P}/device-versions?outdatedOnly=true`,
      headers: operator,
    });
    expect(
      outdated
        .json<DeviceVersions>()
        .tenants[0]?.devices.map((d) => d.name)
        .sort(),
    ).toEqual(['Kiosk 2', 'Main hub']);

    // The health board counts them per tenant.
    const board = (
      await app.inject({ method: 'GET', url: `${P}/health`, headers: operator })
    ).json<HealthBoard>();
    expect(board).toMatchObject({ cloudVersion: MADAR_VERSION, minimums: { hub: MADAR_VERSION } });
    expect(board.tenants.find((t) => t.tenantId === tenant.tenantId)).toMatchObject({
      targetVersion: NEXT,
      outdatedDevices: 1,
      unsupportedDevices: 1,
    });
  });
});
