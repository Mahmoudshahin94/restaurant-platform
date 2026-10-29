// Migrates and seeds a dedicated E2E database before the API starts. Playwright starts web
// servers before globalSetup, so each app's Playwright config runs this in its API command.
// Each app uses its own database (`*_e2e`) so suites can run in parallel.
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL ?? '';
if (!/\/[^/?]*_e2e(\?|$)/.test(url)) {
  console.error(`Refusing to prepare a non-E2E database: ${url}`);
  process.exit(1);
}
const cwd = resolve(import.meta.dirname, '../../packages/database');
execSync('pnpm exec prisma migrate deploy', { cwd, stdio: 'inherit' });
// Orders, payments and shifts from earlier runs would leave tables occupied and drawers open,
// and their sync records would name orders that no longer exist; start every run from a clean
// floor. Websites and their domains start over too (the seed gives each tenant its address), and
// so do payment provider accounts (the seed gives the demo restaurant its test provider), and the
// releases and release channels the platform admin's suite publishes (ADR 0026).
execSync('pnpm exec prisma db execute --stdin --schema prisma/schema.prisma', {
  cwd,
  stdio: ['pipe', 'inherit', 'inherit'],
  input: `TRUNCATE TABLE devices, kitchen_ticket_items, kitchen_tickets, cash_transactions, payments, shifts,
          order_item_modifiers, order_items,
          order_taxes, order_discounts, order_status_history, orders, order_counters,
          processed_operations, change_log, tenant_domains, website_configs,
          releases, tenant_release_channels CASCADE;
          UPDATE payment_methods SET provider_account_id = NULL;
          DELETE FROM payment_provider_secrets;
          DELETE FROM payment_provider_accounts;`,
});
execSync('pnpm seed', {
  cwd,
  stdio: 'inherit',
  // A disposable database: demo tenants follow the seed files even if seeded before they changed.
  env: { ...process.env, SEED_ALIGN_TENANTS: '1' },
});
