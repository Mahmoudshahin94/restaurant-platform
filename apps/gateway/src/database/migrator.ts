import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { HubPrismaClient } from './hub-database';

/** The hub migrations shipped with @pos/database (generated from the cloud schema). */
export function hubMigrationsDir(): string {
  const require = createRequire(__filename);
  return resolve(dirname(require.resolve('@pos/database/package.json')), 'prisma/hub/migrations');
}

function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Applies pending hub migrations at start-up, without the Prisma CLI (a restaurant PC only gets
 * the hub). Each migration runs in one transaction and is recorded with its checksum; a migration
 * that changed after being applied stops the hub instead of silently diverging.
 */
export async function migrateHubDatabase(
  client: HubPrismaClient,
  dir = hubMigrationsDir(),
): Promise<string[]> {
  await client.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "_hub_migrations" ("name" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL, "applied_at" TEXT NOT NULL)',
  );
  const applied = new Map(
    (
      await client.$queryRawUnsafe<{ name: string; checksum: string }[]>(
        'SELECT name, checksum FROM "_hub_migrations"',
      )
    ).map((row) => [row.name, row.checksum]),
  );
  const names = readdirSync(dir)
    .filter((name) => /^\d{14}_\w+$/.test(name))
    .sort();
  const ran: string[] = [];
  for (const name of names) {
    const sql = readFileSync(resolve(dir, name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const known = applied.get(name);
    if (known !== undefined) {
      if (known !== checksum) throw new Error(`Hub migration ${name} changed after it was applied`);
      continue;
    }
    await client.$transaction([
      ...statements(sql).map((statement) => client.$executeRawUnsafe(statement)),
      client.$executeRawUnsafe(
        'INSERT INTO "_hub_migrations" ("name", "checksum", "applied_at") VALUES (?, ?, ?)',
        name,
        checksum,
        new Date().toISOString(),
      ),
    ]);
    ran.push(name);
  }
  return ran;
}
