import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type {
  AdminSyncIssue,
  LocationSyncStatus,
  PairedDevice,
  SyncIssueDetail,
  SyncOperationResult,
  SyncOrder,
  SyncPushResponse,
  SyncResolution,
} from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { createMenuFixture } from './menu-fixture';
import { type SyncBuilders, op, syncBuilders } from './sync-fixture';

let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;
let hub: Record<string, string>;
let deviceId: string;
let b: SyncBuilders;

beforeAll(async () => {
  ({ app, prisma } = await startApp());
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(prisma);
  tenant = await createTenant(prisma);
  const menu = await createMenuFixture(prisma, tenant);
  const cash = await prisma.paymentMethod.create({
    data: { restaurantId: tenant.restaurantId, type: 'CASH', nameEn: 'Cash', nameAr: 'نقدًا' },
  });
  const register = await prisma.cashRegister.create({
    data: { locationId: tenant.locationA, nameEn: 'Drawer 1', nameAr: 'الدرج 1' },
  });
  b = syncBuilders({ tenant, menu, cashMethodId: cash.id, registerId: register.id });
  owner = bearer(await login(app, tenant.owner.email));
  const paired = await app.inject({
    method: 'POST',
    url: `/api/v1/locations/${tenant.locationA}/devices`,
    headers: owner,
    payload: { name: 'Main hub', type: 'GATEWAY' },
  });
  const device = paired.json<PairedDevice>();
  deviceId = device.device.id;
  hub = { authorization: `Device ${device.credential}` };
});

async function push(operations: object[]): Promise<SyncOperationResult[]> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: hub,
    payload: { operations, outbox: { pending: 2, failed: 1 } },
  });
  expect(res.statusCode).toBe(200);
  return res.json<SyncPushResponse>().results;
}

const issuesUrl = () => `/api/v1/locations/${tenant.locationA}/sync/issues`;

async function detail(operationId: string, headers = owner): Promise<SyncIssueDetail> {
  const res = await app.inject({ method: 'GET', url: `${issuesUrl()}/${operationId}`, headers });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<SyncIssueDetail>();
}

function resolve(
  operationId: string,
  action: string,
  note = 'Checked with the branch',
  headers = owner,
) {
  return app.inject({
    method: 'POST',
    url: `${issuesUrl()}/${operationId}/resolve`,
    headers,
    payload: { action, note },
  });
}

async function decision(operationId: string, headers = hub) {
  return app.inject({ method: 'GET', url: `/api/v1/sync/resolutions/${operationId}`, headers });
}

/**
 * A conflict: the hub pushed the order, the cloud's copy was then changed (here directly, as by a
 * support action), and the hub's next change of it is refused.
 */
async function conflictingOrder(): Promise<{ order: SyncOrder; refused: ReturnType<typeof op> }> {
  const order = b.orderRow();
  expect((await push([op('Order', order, 1)]))[0]?.status).toBe('APPLIED');
  await prisma.order.update({
    where: { id: order.id },
    data: { notes: 'Edited in the cloud', version: 2 },
  });
  const refused = op('Order', { ...order, version: 2, notes: 'Changed at the till' }, 2);
  expect(await push([refused])).toEqual([
    expect.objectContaining({ status: 'CONFLICT', code: 'SYNC_CONFLICT' }),
  ]);
  return { order, refused };
}

describe('refused operations for administrators', () => {
  it('keeps the hub’s version next to the cloud’s and says what can be done', async () => {
    const { refused } = await conflictingOrder();
    const list = await app.inject({ method: 'GET', url: issuesUrl(), headers: owner });
    expect(list.json<AdminSyncIssue[]>()).toEqual([
      expect.objectContaining({
        operationId: refused.operationId,
        status: 'CONFLICT',
        hasPayload: true,
        resolution: null,
        label: expect.stringMatching(/^LOCA-/) as unknown,
      }),
    ]);
    const shown = await detail(refused.operationId);
    expect(shown.hubVersion).toMatchObject({ version: 2, itemCount: 1, paymentCount: 0 });
    expect(shown.hubVersion?.data).toMatchObject({ notes: 'Changed at the till' });
    expect(shown.cloudVersion?.data).toMatchObject({ notes: 'Edited in the cloud' });
    expect(shown.options).toEqual({
      applyHub: { allowed: true, reason: null },
      keepCloud: { allowed: true, reason: null },
      resend: { allowed: true, reason: null },
    });

    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationA}/sync/status`,
      headers: owner,
    });
    expect(status.json<LocationSyncStatus>()).toMatchObject({
      openIssues: 1,
      hubs: [{ id: deviceId, status: 'ACTIVE', outbox: { pending: 2, failed: 1 } }],
    });
  });

  it('applies the restaurant’s version, keeping the cloud’s copy in the audit log', async () => {
    const { order, refused } = await conflictingOrder();
    const head = await prisma.changeLog.aggregate({ _max: { seq: true } });

    const res = await resolve(refused.operationId, 'APPLY_HUB');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<SyncIssueDetail>()).toMatchObject({
      issue: { status: 'APPLIED', resolution: 'APPLIED_HUB', resolvedBy: 'Owner' },
      options: { applyHub: { allowed: false, reason: 'ALREADY_RESOLVED' } },
    });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ notes: 'Changed at the till', version: 2 });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'sync.issue_resolved', entityId: order.id },
    });
    expect(audit.metadata).toMatchObject({
      decision: 'APPLY_HUB',
      note: 'Checked with the branch',
      cloudBefore: { notes: 'Edited in the cloud', version: 2 },
    });

    // The hub is told, and sends again: the resolved operation is a duplicate, newer ones apply.
    const feed = await prisma.changeLog.findMany({ where: { seq: { gt: head._max.seq ?? 0n } } });
    expect(feed.map((c) => [c.topic, c.entityId])).toEqual([['RESOLUTION', refused.operationId]]);
    expect((await decision(refused.operationId)).json<SyncResolution>()).toMatchObject({
      action: 'RESEND',
      entityId: order.id,
      order: null,
    });
    expect((await push([refused]))[0]?.status).toBe('DUPLICATE');
    const next = op('Order', { ...order, version: 3, notes: 'Later change' }, 3);
    expect((await push([next]))[0]?.status).toBe('APPLIED');

    const open = await app.inject({ method: 'GET', url: issuesUrl(), headers: owner });
    expect(open.json()).toEqual([]);
    const resolved = await app.inject({
      method: 'GET',
      url: `${issuesUrl()}?state=resolved`,
      headers: owner,
    });
    expect(resolved.json<AdminSyncIssue[]>()).toHaveLength(1);
  });

  it('keeps the cloud’s version: the hub adopts it, and older hub changes are refused', async () => {
    const { order, refused } = await conflictingOrder();
    const res = await resolve(refused.operationId, 'KEEP_CLOUD');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<SyncIssueDetail>().issue).toMatchObject({
      status: 'CONFLICT',
      resolution: 'KEPT_CLOUD',
      resolutionNote: 'Checked with the branch',
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).notes).toBe(
      'Edited in the cloud',
    );
    const told = (await decision(refused.operationId)).json<SyncResolution>();
    expect(told).toMatchObject({ action: 'ADOPT_CLOUD', order: { id: order.id, version: 2 } });

    // The refused change is settled; a change the hub made before adopting is refused…
    expect(await push([refused])).toEqual([
      expect.objectContaining({ status: 'DUPLICATE', code: 'SYNC_SUPERSEDED' }),
    ]);
    const stale = op('Order', { ...order, version: 3, notes: 'Made before adopting' }, 3);
    expect((await push([stale]))[0]?.status).toBe('CONFLICT');
    // …and one built on the cloud's version (it carries that version) is applied.
    const after = {
      ...op('Order', { ...order, version: 3, notes: 'After adopting' }, 4),
      baseVersion: 2,
    };
    expect((await push([after]))[0]?.status).toBe('APPLIED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).notes).toBe(
      'After adopting',
    );
  });

  it('never drops a sale or money taken at the till', async () => {
    const { order, refused } = await conflictingOrder();
    // The hub's refused copy holds a payment the cloud has not recorded.
    const shift = b.shiftRow();
    expect((await push([op('Shift', shift, 1)]))[0]?.status).toBe('APPLIED');
    const withPayment = op(
      'Order',
      { ...b.paid({ ...order, notes: 'Paid' }, shift), version: 3 },
      3,
    );
    expect((await push([withPayment]))[0]?.status).toBe('CONFLICT');
    expect((await detail(withPayment.operationId)).options.keepCloud).toEqual({
      allowed: false,
      reason: 'HUB_HAS_PAYMENTS',
    });
    expect((await resolve(withPayment.operationId, 'KEEP_CLOUD')).json()).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'HUB_HAS_PAYMENTS' },
    });
    expect((await detail(refused.operationId)).options.keepCloud.allowed).toBe(true);

    // A new order the cloud refused (out of scope) is not in the cloud: nothing to keep.
    const elsewhere = op('Order', b.orderRow({ locationId: tenant.locationB }), 1);
    expect((await push([elsewhere]))[0]?.status).toBe('REJECTED');
    const rejected = await detail(elsewhere.operationId);
    expect(rejected.options).toMatchObject({
      applyHub: { allowed: false, reason: 'NOT_A_CONFLICT' },
      keepCloud: { allowed: false, reason: 'NOT_IN_CLOUD' },
    });
  });

  it('asks the hub to resend once the cause is fixed elsewhere', async () => {
    const taken = b.orderRow();
    await push([op('Order', taken, 1)]);
    const clash = op('Order', b.orderRow({ orderNumber: taken.orderNumber }), 1);
    expect((await push([clash]))[0]?.status).toBe('CONFLICT');
    // Applying it would clash again with the cloud's unique order number.
    const failed = await resolve(clash.operationId, 'APPLY_HUB');
    expect(failed.json()).toMatchObject({ code: 'CONFLICT', details: { reason: 'APPLY_FAILED' } });
    expect((await detail(clash.operationId)).issue.resolution).toBeNull();

    await prisma.order.update({ where: { id: taken.id }, data: { orderNumber: 'LOCA-RENAMED' } });
    const resend = await resolve(clash.operationId, 'RESEND');
    expect(resend.json<SyncIssueDetail>().issue.resendRequestedAt).not.toBeNull();
    expect((await decision(clash.operationId)).json<SyncResolution>().action).toBe('RESEND');
    expect((await push([clash]))[0]?.status).toBe('APPLIED');
    const open = await app.inject({ method: 'GET', url: issuesUrl(), headers: owner });
    expect(open.json()).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: 'sync.resend_requested' } })).toBe(1);
  });

  it('requires sync.resolve and a note, and stays within the location', async () => {
    const { refused } = await conflictingOrder();
    const viewer = await prisma.role.create({
      data: {
        restaurantId: tenant.restaurantId,
        name: 'Sync viewer',
        permissions: { create: [{ permissionKey: 'sync.view' }] },
      },
    });
    await prisma.userRole.create({
      data: { userId: tenant.cashier.id, roleId: viewer.id, locationId: tenant.locationA },
    });
    const cashier = bearer(await login(app, tenant.cashier.email));
    expect((await detail(refused.operationId, cashier)).issue.operationId).toBe(
      refused.operationId,
    );
    expect((await resolve(refused.operationId, 'APPLY_HUB', 'ok', cashier)).statusCode).toBe(403);
    expect((await resolve(refused.operationId, 'APPLY_HUB', '')).statusCode).toBe(400);
    const wrongPlace = await app.inject({
      method: 'GET',
      url: `/api/v1/locations/${tenant.locationB}/sync/issues/${refused.operationId}`,
      headers: owner,
    });
    expect(wrongPlace.json()).toMatchObject({ code: 'SYNC_ISSUE_NOT_FOUND' });
    // Nothing decided yet: the hub gets nothing.
    expect((await decision(refused.operationId)).statusCode).toBe(404);
    // Staff tokens cannot read decisions meant for hubs.
    expect((await decision(refused.operationId, owner)).statusCode).toBe(401);
  });

  it('can still settle the stored change of a hub that was replaced', async () => {
    const { order, refused } = await conflictingOrder();
    await app.inject({
      method: 'POST',
      url: `/api/v1/locations/${tenant.locationA}/devices/${deviceId}/disable`,
      headers: owner,
    });
    const shown = await detail(refused.operationId);
    expect(shown.options.resend).toEqual({ allowed: false, reason: 'HUB_DISABLED' });
    expect((await resolve(refused.operationId, 'APPLY_HUB')).statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).notes).toBe(
      'Changed at the till',
    );
  });

  it('stores refused payloads even when they are malformed, for inspection', async () => {
    const malformed = { ...op('Order', b.orderRow(), 1), payload: { id: newId(), total: 'free' } };
    expect((await push([malformed]))[0]?.status).toBe('REJECTED');
    const shown = await detail(malformed.operationId);
    expect(shown.hubVersion?.data).toMatchObject({ total: 'free' });
    expect(shown.options.applyHub.reason).toBe('NOT_A_CONFLICT');
  });
});
