import { OrganizationRole } from '@pos/shared-types';
import { describe, expect, it } from 'vitest';
import {
  ORGANIZATION_ROUTE_ROLES,
  assertOrganizationCurrency,
  assertOwnersRemain,
  brandRoleFor,
} from './organizations';

/** The code of the DomainError `fn` throws, or null when it does not throw. */
function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'NOT_A_DOMAIN_ERROR';
  }
}

describe('brandRoleFor', () => {
  it('maps each organization role to its brand role', () => {
    expect(brandRoleFor(OrganizationRole.OWNER)).toBe('Owner');
    expect(brandRoleFor(OrganizationRole.MANAGER)).toBe('Manager');
    expect(brandRoleFor(OrganizationRole.FINANCE)).toBe('Finance');
  });
});

describe('assertOrganizationCurrency', () => {
  it('passes when the brand uses the organization currency', () => {
    expect(
      codeOf(() => {
        assertOrganizationCurrency('ILS', 'ILS');
      }),
    ).toBeNull();
  });

  it('rejects a brand in another currency', () => {
    expect(
      codeOf(() => {
        assertOrganizationCurrency('ILS', 'SAR');
      }),
    ).toBe('ORGANIZATION_CURRENCY_MISMATCH');
  });
});

describe('assertOwnersRemain', () => {
  const sole = [
    { id: 'a', role: OrganizationRole.OWNER },
    { id: 'b', role: OrganizationRole.MANAGER },
  ];

  it('rejects removing the only owner', () => {
    expect(
      codeOf(() => {
        assertOwnersRemain(sole, { memberId: 'a', role: null });
      }),
    ).toBe('ORGANIZATION_LAST_OWNER');
  });

  it('rejects demoting the only owner', () => {
    expect(
      codeOf(() => {
        assertOwnersRemain(sole, { memberId: 'a', role: OrganizationRole.FINANCE });
      }),
    ).toBe('ORGANIZATION_LAST_OWNER');
  });

  it('allows keeping the only owner as owner', () => {
    expect(
      codeOf(() => {
        assertOwnersRemain(sole, { memberId: 'a', role: OrganizationRole.OWNER });
      }),
    ).toBeNull();
  });

  it('passes when another owner remains', () => {
    const two = [
      { id: 'a', role: OrganizationRole.OWNER },
      { id: 'c', role: OrganizationRole.OWNER },
    ];
    expect(
      codeOf(() => {
        assertOwnersRemain(two, { memberId: 'a', role: null });
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertOwnersRemain(two, { memberId: 'a', role: OrganizationRole.MANAGER });
      }),
    ).toBeNull();
  });

  it('passes when changing or removing a non-owner', () => {
    expect(
      codeOf(() => {
        assertOwnersRemain(sole, { memberId: 'b', role: null });
      }),
    ).toBeNull();
    expect(
      codeOf(() => {
        assertOwnersRemain(sole, { memberId: 'b', role: OrganizationRole.FINANCE });
      }),
    ).toBeNull();
  });

  it('promoting a member to owner leaves an owner', () => {
    expect(
      codeOf(() => {
        assertOwnersRemain(sole, { memberId: 'b', role: OrganizationRole.OWNER });
      }),
    ).toBeNull();
  });
});

describe('ORGANIZATION_ROUTE_ROLES', () => {
  it('lets every role read and only owners manage members', () => {
    expect(ORGANIZATION_ROUTE_ROLES.read).toEqual(['OWNER', 'MANAGER', 'FINANCE']);
    expect(ORGANIZATION_ROUTE_ROLES.manageMembers).toEqual(['OWNER']);
  });
});
