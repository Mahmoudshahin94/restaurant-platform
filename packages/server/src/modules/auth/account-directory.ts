import type { AuthBrand, AuthOrganization } from '@pos/validation';

/**
 * Where an account's brands and organizations come from. Each deployment provides it: the cloud
 * reads every tenant and the organizations, the hub knows its one tenant and no organizations.
 */
export const ACCOUNT_DIRECTORY = Symbol('ACCOUNT_DIRECTORY');

/** A user the organization manages ("linked user", E1). */
export interface LinkedUser {
  accountId: string;
  tenantId: string;
  organizationMemberId: string;
}

export interface AccountDirectory {
  /**
   * The brands the account can sign into: those where its user is active, the tenant is not
   * suspended (an archived one can still be read) and, for a user the organization manages, the
   * organization link stands (`organizationLinkActive`) or the user holds a role of its own.
   * Oldest user first.
   */
  brandsFor(accountId: string): Promise<AuthBrand[]>;
  /** The active organizations the account is a member of, with its role in each. */
  organizationsFor(accountId: string): Promise<AuthOrganization[]>;
  /**
   * Whether the organization link of a linked user stands: the membership is the account's, in
   * the organization the brand belongs to, and that organization is active. The roles the
   * organization added count only while it does. The hub, which has no organizations, answers
   * true: the cloud deactivates users whose membership ends, and that reaches the hub.
   */
  organizationLinkActive(user: LinkedUser): Promise<boolean>;
}
