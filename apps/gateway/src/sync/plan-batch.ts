/**
 * Chooses what the hub sends next (ADR 0012). Pure: the sync engine feeds it the outbox and
 * applies the plan.
 *
 * - **Coalescing:** an operation carries the entity's full state, so only the newest pending
 *   operation of an entity is sent; it covers the older ones.
 * - **Per-entity ordering:** an entity with a FAILED operation, or one waiting for its retry time,
 *   sends nothing; other entities continue.
 * - **Dependencies:** an entity is sent only after every entity it references (an order's shifts,
 *   a ticket's order) has nothing left to send, or goes earlier in the same batch.
 */

export interface OutboxEntry {
  id: string;
  entityType: string;
  entityId: string;
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'COMPLETED';
  nextRetryAt: Date | null;
}

export interface PlannedSend {
  /** `<entityType>:<entityId>` */
  key: string;
  /** The newest operation of the entity: the one sent. */
  sendId: string;
  /** Every operation the send covers (older ones included), marked done when it is accepted. */
  coveredIds: string[];
}

export const entityKey = (entityType: string, entityId: string) => `${entityType}:${entityId}`;

/** Entities an operation's payload references, as entity keys. */
export function dependenciesOf(entityType: string, payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const row = payload as { orderId?: unknown; payments?: unknown };
  if (entityType === 'KitchenTicket' && typeof row.orderId === 'string') {
    return [entityKey('Order', row.orderId)];
  }
  if (entityType === 'Order' && Array.isArray(row.payments)) {
    const refs = new Set<string>();
    for (const p of row.payments as { shiftId?: unknown; deviceId?: unknown }[]) {
      if (typeof p.shiftId === 'string') refs.add(entityKey('Shift', p.shiftId));
      // A kiosk's payment: its pairing reaches the cloud first (ADR 0022).
      if (typeof p.deviceId === 'string') refs.add(entityKey('Device', p.deviceId));
    }
    return [...refs];
  }
  return [];
}

interface Group {
  key: string;
  entries: OutboxEntry[];
}

/** Outbox rows grouped by entity, in the order each entity first appears. */
export function groupByEntity(entries: readonly OutboxEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    if (entry.status === 'COMPLETED') continue;
    const key = entityKey(entry.entityType, entry.entityId);
    let group = groups.get(key);
    if (!group) {
      group = { key, entries: [] };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

/** Whether an entity may send now: nothing failed, nothing waiting for its retry time. */
export function isSendable(group: Group, now: Date): boolean {
  return group.entries.every(
    (e) => e.status !== 'FAILED' && (e.nextRetryAt === null || e.nextRetryAt <= now),
  );
}

/**
 * @param entries   all outbox rows not COMPLETED, oldest first
 * @param deps      dependencies of each candidate's newest operation, by operation id
 * @param maxSends  batch size limit
 */
export function planBatch(
  entries: readonly OutboxEntry[],
  deps: ReadonlyMap<string, readonly string[]>,
  now: Date,
  maxSends: number,
): PlannedSend[] {
  const groups = groupByEntity(entries);
  const unsynced = new Set(groups.map((g) => g.key));
  const planned: PlannedSend[] = [];
  const inBatch = new Set<string>();
  let remaining = groups.filter((g) => isSendable(g, now));

  // Repeated passes let an entity follow a dependency that appears later in the outbox.
  let progress = true;
  while (progress && planned.length < maxSends) {
    progress = false;
    const next: Group[] = [];
    for (const group of remaining) {
      if (planned.length >= maxSends) break;
      const newest = group.entries.at(-1);
      if (!newest) continue;
      const blocked = (deps.get(newest.id) ?? []).some(
        (key) => key !== group.key && unsynced.has(key) && !inBatch.has(key),
      );
      if (blocked) {
        next.push(group);
        continue;
      }
      planned.push({
        key: group.key,
        sendId: newest.id,
        coveredIds: group.entries.map((e) => e.id),
      });
      inBatch.add(group.key);
      progress = true;
    }
    remaining = next;
  }
  return planned;
}

/**
 * Exponential backoff with full jitter: a random delay in [0, min(cap, base × 2^attempt)].
 * Spreads retries of many hubs after an outage instead of having them retry in lockstep.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}
