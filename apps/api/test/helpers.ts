import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient, hashSecret, syncPermissionCatalog } from '@pos/database';
import { PERMISSIONS, type Permission } from '@pos/shared-types';
import { createApp } from '../src/bootstrap';
import { testConfig } from './env';

export const PASSWORD = 'Test-Password-1';
export const ORIGIN = 'http://localhost:5173';

export async function startApp(overrides: Partial<Record<string, string>> = {}): Promise<{
  app: NestFastifyApplication;
  prisma: PrismaClient;
}> {
  const config = testConfig(overrides);
  const app = await createApp(config);
  const prisma = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  return { app, prisma };
}

/** Empties every table except the migration ledger and the permission catalog. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const [{ db }] = await prisma.$queryRaw<[{ db: string }]>`SELECT current_database() AS db`;
  if (!db.endsWith('_test')) throw new Error(`Refusing to truncate non-test database ${db}`);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'permissions')`;
  if (tables.length > 0) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }
  await syncPermissionCatalog(prisma);
}

export interface TenantFixture {
  tenantId: string;
  /** The tenant's website address (`<slug>.localhost`, verified and primary, ADR 0023). */
  host: string;
  locationA: string;
  locationB: string;
  owner: { id: string; email: string };
  cashier: { id: string; email: string };
}

let counter = 0;

/**
 * A tenant with two locations, an Owner (all permissions, tenant-wide) and a Cashier
 * whose role applies to location A only.
 */
export async function createTenant(
  prisma: PrismaClient,
  cashierPermissions: Permission[] = [
    'orders.view',
    'orders.create',
    'locations.view',
    'products.view',
  ],
): Promise<TenantFixture> {
  counter += 1;
  const suffix = `${Date.now().toString(36)}${counter}`;
  const passwordHash = await hashSecret(PASSWORD);
  const tenant = await prisma.tenant.create({
    data: {
      slug: `test-${suffix}`,
      nameEn: 'Test Tenant',
      nameAr: 'مطعم تجريبي',
      currencyCode: 'SAR',
      timezone: 'Asia/Riyadh',
    },
  });
  const host = `${tenant.slug}.localhost`;
  await prisma.tenantDomain.create({
    data: {
      tenantId: tenant.id,
      domain: host,
      kind: 'SUBDOMAIN',
      status: 'VERIFIED',
      isPrimary: true,
      verifiedAt: new Date(),
      verificationToken: `token-${suffix}`,
    },
  });
  const [locationA, locationB] = await Promise.all(
    ['A', 'B'].map((code) =>
      prisma.location.create({
        data: {
          tenantId: tenant.id,
          code: `LOC${code}`,
          nameEn: `Location ${code}`,
          nameAr: `الموقع ${code}`,
          timezone: 'Asia/Riyadh',
          taxInclusive: true,
        },
      }),
    ),
  );
  const ownerRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'Owner',
      isSystem: true,
      permissions: { create: PERMISSIONS.map((permissionKey) => ({ permissionKey })) },
    },
  });
  const cashierRole = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'Cashier',
      permissions: { create: cashierPermissions.map((permissionKey) => ({ permissionKey })) },
    },
  });
  const ownerEmail = `owner-${suffix}@test.local`;
  const ownerAccount = await prisma.account.create({
    data: { email: ownerEmail, passwordHash, lastTenantId: tenant.id },
  });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      accountId: ownerAccount.id,
      email: ownerEmail,
      displayName: 'Owner',
      roles: { create: { roleId: ownerRole.id, locationId: null } },
    },
  });
  const cashierEmail = `cashier-${suffix}@test.local`;
  const cashierAccount = await prisma.account.create({
    data: { email: cashierEmail, passwordHash, lastTenantId: tenant.id },
  });
  const cashier = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      accountId: cashierAccount.id,
      email: cashierEmail,
      displayName: 'Cashier',
      preferredLocale: 'ar',
      roles: { create: { roleId: cashierRole.id, locationId: locationA!.id } },
    },
  });
  return {
    tenantId: tenant.id,
    host,
    locationA: locationA!.id,
    locationB: locationB!.id,
    owner: { id: owner.id, email: owner.email },
    cashier: { id: cashier.id, email: cashier.email },
  };
}

export async function login(app: NestFastifyApplication, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return res.json<{ accessToken: string }>().accessToken;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
