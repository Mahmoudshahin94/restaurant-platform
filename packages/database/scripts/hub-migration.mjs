// Writes the next hub (SQLite) migration: the SQL that turns the schema of the existing hub
// migrations into the current prisma/hub/schema.prisma. Run after `pnpm hub:schema` whenever
// the cloud schema changed, and commit the new folder together with the cloud migration.
//
//   node scripts/hub-migration.mjs <name>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('usage: node scripts/hub-migration.mjs <snake_case_name>');
  process.exit(1);
}
const dir = resolve(root, 'prisma/hub/migrations');
mkdirSync(dir, { recursive: true });
const hasMigrations = readdirSync(dir).some((d) => /^\d{14}_/.test(d));
const sql = execFileSync(
  'pnpm',
  [
    'exec',
    'prisma',
    'migrate',
    'diff',
    hasMigrations ? '--from-migrations' : '--from-empty',
    ...(hasMigrations ? [dir, '--shadow-database-url', 'file:./.hub-shadow.db'] : []),
    '--to-schema-datamodel',
    resolve(root, 'prisma/hub/schema.prisma'),
    '--script',
  ],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HUB_DATABASE_URL: 'file:./.hub-shadow.db' },
  },
);
// Prisma 6 renders JSON column defaults unquoted for SQLite (`DEFAULT []`), which SQLite rejects.
const fixed = sql.replace(
  /DEFAULT ((?:\{[^\n]*?\})|(?:\[[^\n]*?\]))(?=,?\s*$)/gm,
  (_match, json) => `DEFAULT '${json.replaceAll("'", "''")}'`,
);
if (!fixed.trim() || /^-- This is an empty migration/.test(fixed.trim())) {
  console.log('hub schema unchanged: no migration written');
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const target = resolve(dir, `${stamp}_${name}`);
mkdirSync(target);
writeFileSync(resolve(target, 'migration.sql'), fixed);
if (!existsSync(resolve(dir, 'migration_lock.toml'))) {
  writeFileSync(resolve(dir, 'migration_lock.toml'), 'provider = "sqlite"\n');
}
console.log(`wrote prisma/hub/migrations/${stamp}_${name}/migration.sql`);
