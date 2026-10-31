import type { OrganizationRole } from '@pos/shared-types';
import { DomainError } from '../errors';

/** The brand-level role (a seeded system role) an organization role is granted inside each brand. */
export type BrandRoleName = 'Owner' | 'Manager' | 'Finance';

const BRAND_ROLE_BY_ORGANIZATION_ROLE = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  FINANCE: 'Finance',
} as const satisfies Record<OrganizationRole, BrandRoleName>;

/** The brand system role a member holds in every brand of the organization. */
export function brandRoleFor(role: OrganizationRole): BrandRoleName {
  return BRAND_ROLE_BY_ORGANIZATION_ROLE[role];
}

/** One currency per organization: a brand may only join (or be created in) an organization that shares its currency. */
export function assertOrganizationCurrency(
  organizationCurrency: string,
  tenantCurrency: string,
): void {
  if (organizationCurrency !== tenantCurrency) {
    throw new DomainError(
      'ORGANIZATION_CURRENCY_MISMATCH',
      'A brand must use the same currency as its organization',
      { organizationCurrency, tenantCurrency },
    );
  }
}

/**
 * Rejects a member change that would leave the organization without an owner. `role: null` removes
 * the member; any other role replaces theirs (a member not yet listed is added). Making someone an
 * owner never throws. `members` is the organization's current membership.
 */
export function assertOwnersRemain(
  members: readonly { id: string; role: OrganizationRole }[],
  change: { memberId: string; role: OrganizationRole | null },
): void {
  if (change.role === 'OWNER') return;
  const otherOwners = members.filter(
    (member) => member.id !== change.memberId && member.role === 'OWNER',
  );
  if (otherOwners.length === 0) {
    throw new DomainError(
      'ORGANIZATION_LAST_OWNER',
      'An organization must keep at least one owner',
    );
  }
}

/** Who may call the organization routes (the route inventory and the guards read this). */
export const ORGANIZATION_ROUTE_ROLES = {
  read: ['OWNER', 'MANAGER', 'FINANCE'],
  manageMembers: ['OWNER'],
} as const satisfies Record<string, readonly OrganizationRole[]>;
