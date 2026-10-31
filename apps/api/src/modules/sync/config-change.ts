import type { PrismaTx } from '@pos/server';

/**
 * Appends a CONFIG entry to a tenant's change feed for a change no table trigger sees: an
 * organization's status decides which role assignments its brands' snapshots carry (ADR 0029,
 * R16), but the organization is not a row of any brand. Same lock and once-per-transaction rule as
 * the configuration triggers (ADR 0012), so the brand's hubs take a new snapshot. Callers lock
 * several tenants in id order, as the account trigger does, so they cannot deadlock.
 */
export async function recordConfigChange(tx: PrismaTx, tenantId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM (SELECT pg_advisory_xact_lock(
      hashtextextended(${`change_log:${tenantId}`}, 0))) AS locked`;
  await tx.$executeRaw`
    INSERT INTO change_log (tenant_id, topic) VALUES (${tenantId}::uuid, 'CONFIG')
    ON CONFLICT (tenant_id, tx_id) WHERE topic = 'CONFIG' DO NOTHING`;
}
