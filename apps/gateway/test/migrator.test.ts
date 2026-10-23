import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type HubPrismaClient, createHubClient } from '../src/database/hub-database';
import { hubMigrationsDir, migrateHubDatabase } from '../src/database/migrator';
import { removeDir } from './harness';

const dirs: string[] = [];
const clients: HubPrismaClient[] = [];
afterEach(async () => {
  await Promise.all(clients.map((c) => c.$disconnect()));
  for (const d of dirs) removeDir(d);
});

function fresh(): { client: HubPrismaClient; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-hub-migrate-'));
  dirs.push(dir);
  const client = createHubClient(`file:${join(dir, 'hub.db')}?connection_limit=1`);
  clients.push(client);
  return { client, dir };
}

describe('hub migrations', () => {
  it('applies the shipped migrations once and is a no-op afterwards', async () => {
    const { client } = fresh();
    const first = await migrateHubDatabase(client);
    expect(first.length).toBeGreaterThan(0);
    expect(await migrateHubDatabase(client)).toEqual([]);
    const tables = await client.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('orders', 'sync_operations', 'hub_state')",
    );
    expect(tables.map((t) => t.name).sort()).toEqual(['hub_state', 'orders', 'sync_operations']);
    expect(hubMigrationsDir()).toMatch(/prisma\/hub\/migrations$/);
  });

  it('refuses to start when an applied migration was edited', async () => {
    const { client, dir } = fresh();
    const migrations = join(dir, 'migrations');
    mkdirSync(join(migrations, '20260101000000_one'), { recursive: true });
    writeFileSync(
      join(migrations, '20260101000000_one', 'migration.sql'),
      'CREATE TABLE "a" ("x" INTEGER);',
    );
    await migrateHubDatabase(client, migrations);
    writeFileSync(
      join(migrations, '20260101000000_one', 'migration.sql'),
      'CREATE TABLE "a" ("y" INTEGER);',
    );
    await expect(migrateHubDatabase(client, migrations)).rejects.toThrow(
      /changed after it was applied/,
    );
  });

  it('upgrades a hub that already holds orders, payments and cash (online ordering, tenant rename)', async () => {
    const { client, dir } = fresh();
    await client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    // The hub as Phase 6 left it (still naming the tenant a restaurant): every migration before
    // online ordering.
    const before = join(dir, 'before');
    for (const name of readdirSync(hubMigrationsDir()).filter((n) => n < '20261017133550')) {
      cpSync(join(hubMigrationsDir(), name), join(before, name), { recursive: true });
    }
    await migrateHubDatabase(client, before);
    const now = new Date().toISOString();
    for (const sql of [
      `INSERT INTO restaurants (id, slug, name_en, name_ar, currency_code, default_locale, timezone, created_at, updated_at) VALUES ('r', 'r', 'R', 'R', 'SAR', 'en', 'UTC', '${now}', '${now}')`,
      `INSERT INTO locations (id, restaurant_id, code, name_en, name_ar, timezone, tax_inclusive, created_at, updated_at) VALUES ('l', 'r', 'MAIN', 'L', 'L', 'UTC', 1, '${now}', '${now}')`,
      `INSERT INTO cash_registers (id, location_id, name_en, name_ar, created_at, updated_at) VALUES ('c', 'l', 'D', 'D', '${now}', '${now}')`,
      `INSERT INTO payment_methods (id, restaurant_id, type, name_en, name_ar, created_at, updated_at) VALUES ('m', 'r', 'CASH', 'Cash', 'Cash', '${now}', '${now}')`,
      `INSERT INTO shifts (id, restaurant_id, location_id, cash_register_id, status, open_register_id, opening_float, opened_by_id, opened_at, created_at, updated_at) VALUES ('s', 'r', 'l', 'c', 'OPEN', 'c', 0, 'u', '${now}', '${now}', '${now}')`,
      `INSERT INTO orders (id, restaurant_id, location_id, order_number, business_date, channel, status, source, currency_code, tax_inclusive, subtotal, discount_total, tax_total, fee_total, total, created_at, updated_at) VALUES ('o', 'r', 'l', 'MAIN-001', '${now}', 'TAKEAWAY', 'CONFIRMED', 'POS', 'SAR', 1, 100, 0, 13, 0, 100, '${now}', '${now}')`,
      `INSERT INTO payments (id, restaurant_id, location_id, order_id, shift_id, payment_method_id, method_type, method_name_en, method_name_ar, type, status, provider, amount, created_at, updated_at) VALUES ('p', 'r', 'l', 'o', 's', 'm', 'CASH', 'Cash', 'Cash', 'CHARGE', 'CAPTURED', 'cash', 100, '${now}', '${now}')`,
      `INSERT INTO cash_transactions (id, shift_id, type, amount, payment_id, created_at) VALUES ('t', 's', 'SALE', 100, 'p', '${now}')`,
    ]) {
      await client.$executeRawUnsafe(sql);
    }

    // The tables online ordering rebuilds (locations, payments) keep their rows and references,
    // and the tenant rename (ADR 0017) keeps every row under its tenant.
    expect(await migrateHubDatabase(client)).toEqual(
      readdirSync(hubMigrationsDir()).filter((n) => n >= '20261017133550' && /^\d{14}_/.test(n)),
    );
    expect(await client.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    expect(await client.payment.findUnique({ where: { id: 'p' } })).toMatchObject({ shiftId: 's' });
    expect(await client.cashTransaction.findUnique({ where: { id: 't' } })).toMatchObject({
      paymentId: 'p',
    });
    expect(await client.location.findUnique({ where: { id: 'l' } })).toMatchObject({
      onlineAcceptMinutes: 10,
      openingHours: [],
      tenantId: 'r',
    });
    expect(await client.tenant.findUnique({ where: { id: 'r' } })).toMatchObject({ slug: 'r' });
    expect(await client.order.findUnique({ where: { id: 'o' } })).toMatchObject({ tenantId: 'r' });
  });

  it('rolls back a migration that fails halfway', async () => {
    const { client, dir } = fresh();
    const migrations = join(dir, 'migrations');
    mkdirSync(join(migrations, '20260101000000_bad'), { recursive: true });
    writeFileSync(
      join(migrations, '20260101000000_bad', 'migration.sql'),
      'CREATE TABLE "b" ("x" INTEGER);\nCREATE TABLE broken syntax here;',
    );
    await expect(migrateHubDatabase(client, migrations)).rejects.toThrow();
    const left = await client.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'b'",
    );
    expect(left).toEqual([]);
  });
});
