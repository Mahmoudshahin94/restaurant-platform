import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrganizationSeedFile, seedOrganization } from './seed';
import { seedDemoOrders } from './seed-orders';

/**
 * The demo organization seed against a database of its own (created from the test server's, so
 * the API suites that share TEST_DATABASE_URL are not disturbed), migrated like any other.
 */
const ROOT = resolve(__dirname, '../../..');
const DATABASE = 'pos_kds_seed_test';

const SEED_ENV = {
  NODE_ENV: 'test',
  PLATFORM_WEB_DOMAIN: 'localhost',
  SEED_ORG_OWNER_EMAIL: 'Owner@Group.Local ',
  SEED_ORG_OWNER_PASSWORD: 'Seed-Test-Owner-Pass-1',
  SEED_ORG_FINANCE_EMAIL: 'finance@group.local',
  SEED_ORG_FINANCE_PASSWORD: 'Seed-Test-Finance-Pass-1',
};

let admin: PrismaClient;
let prisma: PrismaClient;
let url: string;
let file: OrganizationSeedFile;

beforeAll(async () => {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is required for the seed test');
  const parsed = new URL(testUrl);
  parsed.pathname = `/${DATABASE}`;
  url = parsed.toString();
  admin = new PrismaClient({ datasourceUrl: testUrl });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${DATABASE}`);
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(ROOT, 'packages/database'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  prisma = new PrismaClient({ datasourceUrl: url });
  file = JSON.parse(
    readFileSync(resolve(ROOT, 'packages/database/seed/organizations/01-demo-foods.json'), 'utf8'),
  ) as OrganizationSeedFile;
  Object.assign(process.env, SEED_ENV);
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await admin.$disconnect();
});

async function seedAll() {
  const { tenants } = await seedOrganization(prisma, file);
  for (const tenant of tenants) {
    expect(await seedDemoOrders(prisma, tenant)).not.toBeNull();
  }
}

describe('demo organization seed', () => {
  it('seeding twice yields one organization, two brands, five branches and the same order count', async () => {
    await seedAll();
    const counts = async () => ({
      organizations: await prisma.organization.count(),
      brands: await prisma.tenant.count({ where: { organization: { slug: 'demo-foods' } } }),
      branches: await prisma.location.count({
        where: { tenant: { organization: { slug: 'demo-foods' } } },
      }),
      codes: (
        await prisma.location.findMany({ select: { code: true }, orderBy: { code: 'asc' } })
      ).map((l) => l.code),
      members: await prisma.organizationMember.count(),
      users: await prisma.user.count(),
      orders: await prisma.order.count(),
      payments: await prisma.payment.count(),
      shifts: await prisma.shift.count(),
    });
    const first = await counts();
    expect(first).toMatchObject({
      organizations: 1,
      brands: 2,
      branches: 5,
      codes: ['BH1', 'BH2', 'BH3', 'PP1', 'PP2'],
      members: 2,
      users: 4,
    });
    expect(first.orders).toBeGreaterThan(5 * 30 * 5);
    expect(first.payments).toBe(first.orders);

    await seedAll();
    expect(await counts()).toEqual(first);
  });

  it('links each member to a user in every brand with the brand role of their organization role', async () => {
    const owner = await prisma.account.findUniqueOrThrow({
      where: { email: 'owner@group.local' },
      include: {
        users: { include: { roles: { include: { role: true } }, tenant: true } },
        memberships: true,
      },
    });
    expect(owner.memberships.map((m) => m.role)).toEqual(['OWNER']);
    expect(owner.users.map((u) => u.tenant.slug).sort()).toEqual(['burger-house', 'pizza-point']);
    for (const user of owner.users) {
      expect(user.organizationMemberId).toBe(owner.memberships[0]?.id);
      expect(user.roles).toHaveLength(1);
      expect(user.roles[0]).toMatchObject({
        locationId: null,
        grantedByOrganization: true,
        role: { name: 'Owner' },
      });
    }
    const finance = await prisma.user.findMany({
      where: { email: 'finance@group.local' },
      include: { roles: { include: { role: true } } },
    });
    expect(finance).toHaveLength(2);
    expect(finance.every((u) => u.roles[0]?.role.name === 'Finance')).toBe(true);
  });

  it('puts every brand and branch in ILS and Asia/Hebron', async () => {
    const tenants = await prisma.tenant.findMany({ include: { locations: true } });
    expect(tenants.map((t) => t.currencyCode)).toEqual(['ILS', 'ILS']);
    expect(tenants.flatMap((t) => t.locations).every((l) => l.timezone === 'Asia/Hebron')).toBe(
      true,
    );
  });

  it('produces completed, paid orders the reports count, 30 business days per branch', async () => {
    const rows = await prisma.$queryRaw<
      { code: string; days: bigint; orders: bigint; total: bigint }[]
    >`
      SELECT l.code, COUNT(DISTINCT s.business_date) AS days, COUNT(*) AS orders, SUM(s.total) AS total
      FROM report_sales_orders s JOIN locations l ON l.id = s.location_id
      GROUP BY l.code ORDER BY l.code`;
    expect(rows.map((r) => r.code)).toEqual(['BH1', 'BH2', 'BH3', 'PP1', 'PP2']);
    for (const r of rows) {
      expect(Number(r.days)).toBe(30);
      expect(Number(r.total)).toBeGreaterThan(0);
    }
    const unpaid = await prisma.order.count({ where: { NOT: { paymentStatus: 'PAID' } } });
    expect(unpaid).toBe(0);
    const [sums] = await prisma.$queryRaw<{ orders: bigint; payments: bigint }[]>`
      SELECT (SELECT SUM(total) FROM orders) AS orders, (SELECT SUM(amount) FROM payments) AS payments`;
    expect(sums?.payments).toBe(sums?.orders);
  });
});
