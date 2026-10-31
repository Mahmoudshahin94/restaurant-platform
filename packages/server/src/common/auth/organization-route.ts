/**
 * An organization's routes (`/organizations/:organizationId/*`, E1): a staff access token whose
 * account is a member of the organization, in one of the roles the route allows. The cloud's
 * `@OrganizationRoute(roles)` sets this metadata and applies `OrganizationGuard` (required by the
 * start-up check), which also runs the handler in the organization's read-only scope. The global
 * guards authenticate the token and leave the authorization to that guard; the route inventory
 * lists these routes as `organization`.
 */
export const ORGANIZATION_ROUTE_KEY = 'auth:organizationRoles';

/** The organization guard's name: every organization route must be behind it. */
export const ORGANIZATION_GUARD_NAME = 'OrganizationGuard';
