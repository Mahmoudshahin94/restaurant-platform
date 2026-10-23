import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaClient } from '@pos/database';
import { TenantContext } from '@pos/server';
import type { ApiErrorBody } from '@pos/shared-types';
import type {
  PublicTenant,
  TenantBrandingDto,
  TenantContextDto,
  TenantFileDto,
  UpdateBrandingRequest,
} from '@pos/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotService } from '../src/modules/sync/snapshot.service';
import {
  type TenantFixture,
  bearer,
  createTenant,
  login,
  resetDatabase,
  startApp,
} from './helpers';
import { ICO, JPEG, PNG, SVG } from './image-fixture';

/**
 * Branding and tenant files (ADR 0019): uploads and their checks, the Branding API and its
 * contrast rule, branding in the tenant context for each surface, the public files of the
 * customer website, and branding reaching the hubs (change feed, snapshot with file bytes).
 */
let app: NestFastifyApplication;
let prisma: PrismaClient;
let tenant: TenantFixture;
let owner: Record<string, string>;

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
  owner = bearer(await login(app, tenant.owner.email));
});

const base = () => `/api/v1/tenants/${tenant.tenantId}`;

function upload(kind: 'LOGO' | 'FAVICON', bytes: Buffer, contentType: string, headers = owner) {
  return app.inject({
    method: 'POST',
    url: `${base()}/files?kind=${kind}`,
    headers: { ...headers, 'content-type': contentType },
    payload: bytes,
  });
}

async function uploaded(kind: 'LOGO' | 'FAVICON', bytes = PNG, type = 'image/png') {
  const res = await upload(kind, bytes, type);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<TenantFileDto>();
}

const EMPTY: UpdateBrandingRequest = {
  displayNameEn: null,
  displayNameAr: null,
  logoFileId: null,
  faviconFileId: null,
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  fontFamily: null,
  logoSize: null,
  themeMode: null,
  surfaceStyle: null,
  borderRadius: null,
};

function putBranding(body: Partial<UpdateBrandingRequest>, headers = owner) {
  return app.inject({
    method: 'PUT',
    url: `${base()}/branding`,
    headers,
    payload: { ...EMPTY, ...body },
  });
}

async function context(query = '', headers = owner): Promise<TenantContextDto> {
  const res = await app.inject({ method: 'GET', url: `${base()}/context${query}`, headers });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<TenantContextDto>();
}

describe('tenant files', () => {
  it('stores a logo and serves it back as an inert image to any member', async () => {
    const file = await uploaded('LOGO');
    expect(file).toMatchObject({ kind: 'LOGO', contentType: 'image/png', sizeBytes: PNG.length });

    const cashier = bearer(await login(app, tenant.cashier.email));
    const res = await app.inject({
      method: 'GET',
      url: `${base()}/files/${file.id}/content`,
      headers: cashier,
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(res.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });

    const list = await app.inject({ method: 'GET', url: `${base()}/files`, headers: owner });
    expect(list.json<TenantFileDto[]>().map((f) => f.id)).toEqual([file.id]);
    const row = await prisma.tenantFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.storageKey).toBe(`tenants/${tenant.tenantId}/logo/${file.id}.png`);
    expect(
      await prisma.auditLog.count({ where: { action: 'tenant_file.uploaded', entityId: file.id } }),
    ).toBe(1);
  });

  it('accepts PNG, JPEG and WebP logos and ICO favicons', async () => {
    await uploaded('LOGO', JPEG, 'image/jpeg');
    const webp = Buffer.concat([Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'), PNG]);
    await uploaded('LOGO', webp, 'image/webp');
    await uploaded('FAVICON', ICO, 'image/x-icon');
    await uploaded('FAVICON', ICO, 'image/vnd.microsoft.icon');
  });

  it('refuses SVG, mislabelled bytes, the wrong kind, oversized and empty files', async () => {
    const cases: [ReturnType<typeof upload>, number, string][] = [
      [upload('LOGO', SVG, 'image/svg+xml'), 415, 'FILE_TYPE_NOT_ALLOWED'],
      [upload('LOGO', SVG, 'image/png'), 415, 'FILE_TYPE_NOT_ALLOWED'],
      [upload('LOGO', PNG, 'image/jpeg'), 415, 'FILE_TYPE_NOT_ALLOWED'],
      [upload('LOGO', ICO, 'image/x-icon'), 415, 'FILE_TYPE_NOT_ALLOWED'],
      [upload('LOGO', Buffer.alloc(0), 'image/png'), 415, 'FILE_TYPE_NOT_ALLOWED'],
      [
        upload('FAVICON', Buffer.concat([PNG, Buffer.alloc(200 * 1024)]), 'image/png'),
        413,
        'FILE_TOO_LARGE',
      ],
    ];
    for (const [request, status, code] of cases) {
      const res = await request;
      expect(res.statusCode, res.body).toBe(status);
      expect(res.json<ApiErrorBody>().code).toBe(code);
    }
    const html = await upload('LOGO', SVG, 'text/html');
    expect(html.statusCode).toBe(415);
    expect(await prisma.tenantFile.count()).toBe(0);
  });

  it('needs settings.manage to upload', async () => {
    const cashier = bearer(await login(app, tenant.cashier.email));
    expect((await upload('LOGO', PNG, 'image/png', cashier)).statusCode).toBe(403);
  });
});

describe('the Branding API', () => {
  it('starts from MADAR defaults and the tenant’s names', async () => {
    const res = await app.inject({ method: 'GET', url: `${base()}/branding`, headers: owner });
    expect(res.statusCode).toBe(200);
    const body = res.json<TenantBrandingDto>();
    expect(body.tenant.primaryColor).toBeNull();
    expect(body.surfaces).toEqual({});
    expect(body.updatedAt).toBeNull();
    expect(body.resolved).toMatchObject({
      displayNameEn: 'Test Tenant',
      themeMode: 'DARK',
      surfaceStyle: 'SOLID',
      primaryColor: null,
    });
    expect(body.resolved.sources.themeMode).toBe('PLATFORM');
  });

  it('saves colours, files and surface overrides, audited, and resolves them per surface', async () => {
    const logo = await uploaded('LOGO');
    const kdsLogo = await uploaded('LOGO');
    const favicon = await uploaded('FAVICON', ICO, 'image/x-icon');
    const res = await putBranding({
      displayNameEn: 'Falafel House',
      logoFileId: logo.id,
      faviconFileId: favicon.id,
      primaryColor: '#2563EB',
      accentColor: '#dc2626',
      themeMode: 'LIGHT',
      surfaceStyle: 'GLASS',
      borderRadius: 12,
      surfaces: {
        kds: { themeMode: 'DARK', logoFileId: kdsLogo.id, primaryColor: null },
        website: { primaryColor: '#16a34a' },
        login: {},
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const saved = res.json<TenantBrandingDto>();
    expect(saved.tenant.primaryColor).toBe('#2563eb');
    // Unset values and empty surfaces are not stored.
    expect(saved.surfaces).toEqual({
      kds: { themeMode: 'DARK', logoFileId: kdsLogo.id },
      website: { primaryColor: '#16a34a' },
    });
    expect(saved.files.map((f) => f.id).sort()).toEqual([logo.id, kdsLogo.id, favicon.id].sort());

    const admin = (await context()).branding;
    expect(admin).toMatchObject({
      surface: null,
      displayNameEn: 'Falafel House',
      displayNameAr: 'مطعم تجريبي',
      logoFileId: logo.id,
      themeMode: 'LIGHT',
      surfaceStyle: 'GLASS',
      borderRadius: 12,
    });
    expect(admin.sources).toMatchObject({ displayNameAr: 'PLATFORM', themeMode: 'TENANT' });

    const kds = (await context('?surface=kds')).branding;
    expect(kds).toMatchObject({
      surface: 'kds',
      themeMode: 'DARK',
      logoFileId: kdsLogo.id,
      primaryColor: '#2563eb',
    });
    expect(kds.sources).toMatchObject({ themeMode: 'SURFACE', primaryColor: 'TENANT' });
    expect((await context('?surface=website')).branding.primaryColor).toBe('#16a34a');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'branding.updated' } });
    expect((audit.metadata as { changed: string[] }).changed).toContain('primaryColor');
  });

  it('refuses unreadable colours, naming each one and what it disappears into', async () => {
    const res = await putBranding({
      primaryColor: '#111827',
      surfaces: { kds: { accentColor: '#fde047' } },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<ApiErrorBody>();
    expect(body.code).toBe('BRANDING_UNREADABLE');
    expect(body.details.issues).toEqual([
      expect.objectContaining({ path: ['primaryColor'], against: 'DARK' }),
      expect.objectContaining({ path: ['surfaces', 'kds', 'accentColor'], against: 'LIGHT' }),
    ]);
    expect(await prisma.tenantBranding.count()).toBe(0);
  });

  it('refuses malformed values, unknown surfaces and settings', async () => {
    for (const body of [
      { primaryColor: 'blue' },
      { borderRadius: 99 },
      { themeMode: 'SEPIA' },
      { surfaces: { tv: { themeMode: 'DARK' } } },
      { surfaces: { pos: { fontSize: 20 } } },
    ]) {
      const res = await putBranding(body as Partial<UpdateBrandingRequest>);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('refuses a favicon as the logo and a file that is not there', async () => {
    const favicon = await uploaded('FAVICON', ICO, 'image/x-icon');
    const wrongKind = await putBranding({ logoFileId: favicon.id });
    expect(wrongKind.json<ApiErrorBody>().code).toBe('FILE_TYPE_NOT_ALLOWED');
    const missing = await putBranding({
      surfaces: { pos: { logoFileId: '01890a5d-ac96-774b-bcce-b302099a8000' } },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ApiErrorBody>().code).toBe('FILE_NOT_FOUND');
  });

  it('is for settings.manage only', async () => {
    const cashier = bearer(await login(app, tenant.cashier.email));
    expect((await putBranding({ primaryColor: '#2563eb' }, cashier)).statusCode).toBe(403);
    // Every member reads the resolved branding through the context.
    expect((await context('?surface=pos', cashier)).branding.surface).toBe('pos');
  });
});

describe('the customer website', () => {
  it('gets the website surface and only the files branding shows', async () => {
    const logo = await uploaded('LOGO');
    const unused = await uploaded('LOGO');
    await putBranding({ logoFileId: logo.id, surfaces: { website: { themeMode: 'LIGHT' } } });
    const { slug } = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.tenantId } });

    const res = await app.inject({ method: 'GET', url: `/api/v1/public/tenants/${slug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<PublicTenant>().branding).toMatchObject({
      surface: 'website',
      themeMode: 'LIGHT',
      logoFileId: logo.id,
    });

    const file = (id: string) =>
      app.inject({ method: 'GET', url: `/api/v1/public/tenants/${slug}/files/${id}` });
    const shown = await file(logo.id);
    expect(shown.statusCode).toBe(200);
    expect(shown.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(shown.rawPayload.equals(PNG)).toBe(true);
    expect((await file(unused.id)).statusCode).toBe(404);
  });
});

describe('branding reaches the location hubs', () => {
  it('records a CONFIG change when branding changes', async () => {
    const changes = () =>
      prisma.changeLog.count({ where: { tenantId: tenant.tenantId, topic: 'CONFIG' } });
    const before = await changes();
    await putBranding({ primaryColor: '#2563eb' });
    expect(await changes()).toBe(before + 1);
    // Saving the same branding again changes nothing.
    await putBranding({ primaryColor: '#2563eb' });
    expect(await changes()).toBe(before + 1);
  });

  it('puts branding and the bytes of the files it shows in the snapshot', async () => {
    const logo = await uploaded('LOGO');
    await uploaded('LOGO');
    await putBranding({ logoFileId: logo.id, primaryColor: '#2563eb' });
    const snapshot = await TenantContext.runInTenant(tenant.tenantId, () =>
      app.get(SnapshotService).build({
        id: '01890a5d-ac96-774b-bcce-b302099a8001',
        tenantId: tenant.tenantId,
        locationId: tenant.locationA,
      }),
    );
    expect(snapshot.format).toBe(4);
    expect(snapshot.tables.tenantBranding).toEqual([
      expect.objectContaining({ tenantId: tenant.tenantId, primaryColor: '#2563eb' }),
    ]);
    expect(snapshot.tables.tenantFiles.map((f) => f.id)).toEqual([logo.id]);
    expect(snapshot.files).toEqual([{ id: logo.id, content: PNG.toString('base64') }]);
  });
});
