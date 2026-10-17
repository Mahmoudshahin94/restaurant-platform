import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { type SyncIssueFacts, assertSyncResolution, syncResolutionOptions } from './resolution';

const conflict: SyncIssueFacts = {
  status: 'CONFLICT',
  errorCode: 'SYNC_CONFLICT',
  entityType: 'Order',
  resolved: false,
  hasHubVersion: true,
  cloudHasEntity: true,
  hubOnlyPaymentIds: [],
  hubActive: true,
};

describe('syncResolutionOptions', () => {
  it('offers every action for an order conflict whose hub version the cloud kept', () => {
    const options = syncResolutionOptions(conflict);
    expect(options.APPLY_HUB.allowed).toBe(true);
    expect(options.KEEP_CLOUD.allowed).toBe(true);
    expect(options.RESEND.allowed).toBe(true);
  });

  it('applies the hub version only for ownership conflicts it has the state of', () => {
    expect(syncResolutionOptions({ ...conflict, status: 'REJECTED' }).APPLY_HUB.reason).toBe(
      'NOT_A_CONFLICT',
    );
    expect(syncResolutionOptions({ ...conflict, hasHubVersion: false }).APPLY_HUB.reason).toBe(
      'NO_HUB_VERSION',
    );
  });

  it('never keeps the cloud copy when that would drop a sale or money taken at the till', () => {
    expect(syncResolutionOptions({ ...conflict, cloudHasEntity: false }).KEEP_CLOUD.reason).toBe(
      'NOT_IN_CLOUD',
    );
    expect(
      syncResolutionOptions({ ...conflict, hubOnlyPaymentIds: ['p1'] }).KEEP_CLOUD.reason,
    ).toBe('HUB_HAS_PAYMENTS');
    expect(syncResolutionOptions({ ...conflict, entityType: 'Shift' }).KEEP_CLOUD.reason).toBe(
      'ORDERS_ONLY',
    );
  });

  it('allows nothing once resolved, and no resend to a hub that was disabled', () => {
    for (const facts of [
      { ...conflict, resolved: true },
      { ...conflict, status: 'APPLIED' as const },
    ]) {
      const options = syncResolutionOptions(facts);
      expect(Object.values(options).every((o) => o.reason === 'ALREADY_RESOLVED')).toBe(true);
    }
    const replaced = syncResolutionOptions({ ...conflict, hubActive: false });
    expect(replaced.RESEND.reason).toBe('HUB_DISABLED');
    // The stored change of a replaced hub can still be applied (or the cloud's copy kept).
    expect(replaced.APPLY_HUB.allowed).toBe(true);
    expect(replaced.KEEP_CLOUD.allowed).toBe(true);
  });

  it('refuses a blocked action with its reason', () => {
    expect(() => {
      assertSyncResolution({ ...conflict, hubOnlyPaymentIds: ['p1'] }, 'KEEP_CLOUD');
    }).toThrow(DomainError);
    try {
      assertSyncResolution({ ...conflict, status: 'REJECTED' }, 'APPLY_HUB');
    } catch (error) {
      expect((error as DomainError).details).toEqual({ reason: 'NOT_A_CONFLICT' });
    }
  });
});
