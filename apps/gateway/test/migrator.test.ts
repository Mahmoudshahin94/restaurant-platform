import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
