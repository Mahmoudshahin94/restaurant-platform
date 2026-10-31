import type { AuthBrand, AuthOrganization } from '@pos/validation';

/**
 * Where an account's brands and organizations come from. Each deployment provides it: the cloud
 * reads every tenant and the organizations, the hub knows its one tenant and no organizations.
 */
export const ACCOUNT_DIRECTORY = Symbol('ACCOUNT_DIRECTORY');

export interface AccountDirectory {
  /**
   * The brands the account can sign into: those where its user is active, the tenant is not
   * suspended (an archived one can still be read) and, for a user the organization manages, the
   * organization is active. Oldest user first.
   */
  brandsFor(accountId: string): Promise<AuthBrand[]>;
  /** The active organizations the account is a member of, with its role in each. */
  organizationsFor(accountId: string): Promise<AuthOrganization[]>;
}
