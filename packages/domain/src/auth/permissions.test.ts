import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import {
  accessibleLocations,
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
  it('applies restaurant-wide roles to every location', () => {
    expect(resolvePermissions(owner, LOC_B).has('orders.view')).toBe(true);
    expect(resolvePermissions(owner, null).has('settings.manage')).toBe(true);
  });

  it('applies location roles only to their location', () => {
    expect(resolvePermissions(branchCashier, LOC_A).has('orders.create')).toBe(true);
    expect(resolvePermissions(branchCashier, LOC_B).size).toBe(0);
  });

  it('does not let location roles grant restaurant-level permissions', () => {
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
