import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  accessibleLocations,
  assertCanGrant,
  locationsWithPermissions,
  assertPermissions,
  canAccessLocation,
  hasAllPermissions,
  resolvePermissions,
  type RoleAssignment,
} from './permissions';

const LOC_A = 'loc-a';
const LOC_B = 'loc-b';

const owner: RoleAssignment[] = [
  { locationId: null, permissions: ['settings.manage', 'orders.view'] },
];
const branchCashier: RoleAssignment[] = [
  { locationId: LOC_A, permissions: ['orders.view', 'orders.create'] },
];

describe('resolvePermissions', () => {
  it('applies tenant-wide roles to every location', () => {
    expect(resolvePermissions(owner, LOC_B).has('orders.view')).toBe(true);
    expect(resolvePermissions(owner, null).has('settings.manage')).toBe(true);
  });

  it('applies location roles only to their location', () => {
    expect(resolvePermissions(branchCashier, LOC_A).has('orders.create')).toBe(true);
    expect(resolvePermissions(branchCashier, LOC_B).size).toBe(0);
  });

  it('does not let location roles grant tenant-level permissions', () => {
    expect(resolvePermissions(branchCashier, null).size).toBe(0);
  });

  it('unions multiple assignments', () => {
    const granted = resolvePermissions([...owner, ...branchCashier], LOC_A);
    expect(hasAllPermissions(granted, ['settings.manage', 'orders.create'])).toBe(true);
  });
});

describe('location access', () => {
  it('checks location reach', () => {
    expect(canAccessLocation(branchCashier, LOC_A)).toBe(true);
    expect(canAccessLocation(branchCashier, LOC_B)).toBe(false);
    expect(accessibleLocations(owner)).toBe('ALL');
    expect(accessibleLocations(branchCashier)).toEqual([LOC_A]);
  });
});

describe('assertPermissions', () => {
  it('throws INSUFFICIENT_PERMISSION listing what is missing', () => {
    try {
      assertPermissions(branchCashier, LOC_A, ['orders.create', 'orders.refund']);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('INSUFFICIENT_PERMISSION');
      expect((error as DomainError).details).toEqual({ missing: ['orders.refund'] });
    }
  });
});

describe('locationsWithPermissions', () => {
  it('lists every location for tenant-wide grants and only matching ones otherwise', () => {
    expect(locationsWithPermissions(owner, [LOC_A, LOC_B], ['orders.view'])).toEqual([
      LOC_A,
      LOC_B,
    ]);
    expect(locationsWithPermissions(branchCashier, [LOC_A, LOC_B], ['orders.view'])).toEqual([
      LOC_A,
    ]);
    expect(locationsWithPermissions(branchCashier, [LOC_A, LOC_B], ['audit.view'])).toEqual([]);
  });
});

describe('assertCanGrant', () => {
  it('lets people grant only what they hold at that scope', () => {
    expect(() => {
      assertCanGrant(owner, null, ['orders.view']);
    }).not.toThrow();
    expect(() => {
      assertCanGrant(branchCashier, LOC_A, ['orders.create']);
    }).not.toThrow();
    // A branch role cannot be handed out tenant-wide, nor more than the actor holds.
    expect(() => {
      assertCanGrant(branchCashier, null, ['orders.create']);
    }).toThrow(DomainError);
    try {
      assertCanGrant(owner, LOC_B, ['orders.view', 'roles.manage']);
    } catch (error) {
      expect((error as DomainError).details).toEqual({
        missing: ['roles.manage'],
        reason: 'ESCALATION',
      });
    }
  });
});
