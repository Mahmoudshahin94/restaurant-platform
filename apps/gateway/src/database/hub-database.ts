import { PrismaClient as HubPrismaClient } from '@pos/database/hub-client';
import type { PrismaService } from '@pos/server';

export { HubPrismaClient };
export type HubTx = Parameters<Parameters<HubPrismaClient['$transaction']>[0]>[0];

/**
 * The hub's SQLite client. Its models are identical to the cloud client's (enforced by the
 * contract test in @pos/database), so the shared services receive it as their `PrismaService`.
 */
export function createHubClient(databaseUrl: string): HubPrismaClient {
  return new HubPrismaClient({ datasourceUrl: databaseUrl });
}

export const asServerClient = (client: HubPrismaClient): PrismaService =>
  client as unknown as PrismaService;

/** The hub-only models (outbox, hub state) are reached through the hub client's own types. */
export const asHubTx = (tx: unknown): HubTx => tx as HubTx;

/**
 * Durability first: write-ahead logging, a full fsync on every commit (a till must not lose a
 * paid order to a power cut), and enforced foreign keys.
 */
export async function configureSqlite(client: HubPrismaClient): Promise<void> {
  await client.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await client.$queryRawUnsafe('PRAGMA synchronous = FULL');
  await client.$queryRawUnsafe('PRAGMA foreign_keys = ON');
  await client.$queryRawUnsafe('PRAGMA busy_timeout = 10000');
}
