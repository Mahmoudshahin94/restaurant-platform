import { DomainError } from '../errors';

/**
 * What an administrator may do with an operation the cloud refused from a location hub
 * (ADR 0014). The rule: nothing is overwritten or dropped silently.
 *
 * - **Apply the restaurant's version** (`APPLY_HUB`): only for ownership conflicts (`CONFLICT` /
 *   `SYNC_CONFLICT`) whose hub state the cloud kept. The cloud's copy is written to the audit log
 *   before the hub's state replaces it; payments stay append-only.
 * - **Keep the cloud's version** (`KEEP_CLOUD`): only for orders the cloud has, and never when the
 *   hub's copy holds payments the cloud has not recorded (money taken at the till must arrive).
 *   The hub then replaces its copy with the cloud's and its change is marked superseded.
 * - **Ask the hub to resend** (`RESEND`): after the cause was fixed elsewhere (for example a
 *   rejected change whose missing data was added); the cloud judges the resend like any push.
 */
export type SyncResolutionAction = 'APPLY_HUB' | 'KEEP_CLOUD' | 'RESEND';

export type SyncResolutionBlock =
  | 'ALREADY_RESOLVED'
  | 'NOT_A_CONFLICT'
  | 'NO_HUB_VERSION'
  | 'ORDERS_ONLY'
  | 'NOT_IN_CLOUD'
  | 'HUB_HAS_PAYMENTS'
  | 'HUB_DISABLED';

export interface SyncIssueFacts {
  /** Ledger status: APPLIED once settled by applying the hub's version. */
  status: 'APPLIED' | 'CONFLICT' | 'REJECTED';
  errorCode: string | null;
  entityType: string;
  /** Already settled by an administrator. */
  resolved: boolean;
  /** The cloud kept the hub's refused state (refusals recorded before Phase 8 did not). */
  hasHubVersion: boolean;
  /** The cloud has its own copy of the entity. */
  cloudHasEntity: boolean;
  /** Payment ids in the hub's copy that the cloud has not recorded. */
  hubOnlyPaymentIds: readonly string[];
  /**
   * The hub that sent the operation can still receive the decision (device active). Without it
   * nothing can be resent, but the cloud's own record can still be settled (a replaced hub's
   * stored change can be applied, rescuing data the old hub never delivered).
   */
  hubActive: boolean;
}

export interface ResolutionOption {
  allowed: boolean;
  reason: SyncResolutionBlock | null;
}

const allow: ResolutionOption = { allowed: true, reason: null };
const block = (reason: SyncResolutionBlock): ResolutionOption => ({ allowed: false, reason });

export function syncResolutionOptions(
  facts: SyncIssueFacts,
): Record<SyncResolutionAction, ResolutionOption> {
  if (facts.resolved || facts.status === 'APPLIED') {
    const done = block('ALREADY_RESOLVED');
    return { APPLY_HUB: done, KEEP_CLOUD: done, RESEND: done };
  }
  const applyHub =
    facts.status !== 'CONFLICT' || facts.errorCode !== 'SYNC_CONFLICT'
      ? block('NOT_A_CONFLICT')
      : !facts.hasHubVersion
        ? block('NO_HUB_VERSION')
        : allow;
  const keepCloud =
    facts.entityType !== 'Order'
      ? block('ORDERS_ONLY')
      : !facts.cloudHasEntity
        ? block('NOT_IN_CLOUD')
        : facts.hubOnlyPaymentIds.length > 0
          ? block('HUB_HAS_PAYMENTS')
          : allow;
  const resend = facts.hubActive ? allow : block('HUB_DISABLED');
  return { APPLY_HUB: applyHub, KEEP_CLOUD: keepCloud, RESEND: resend };
}

/** Throws unless `action` is allowed for the issue; the reason is the error's `details.reason`. */
export function assertSyncResolution(facts: SyncIssueFacts, action: SyncResolutionAction): void {
  const option = syncResolutionOptions(facts)[action];
  if (!option.allowed) {
    throw new DomainError('CONFLICT', `This issue cannot be resolved with ${action}`, {
      reason: option.reason,
    });
  }
}
