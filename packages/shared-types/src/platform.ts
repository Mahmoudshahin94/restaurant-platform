/**
 * MADAR's own operators (ADR 0025): a separate identity from every tenant's staff, with its own
 * roles and permission catalog. A tenant user can never hold a platform permission, and a platform
 * user is never a member of a tenant.
 */

type ValueOf<T> = T[keyof T];

export const PlatformRole = {
  /** Everything, including what later phases add (platform users, releases). */
  OWNER: 'OWNER',
  /** Runs the platform: provisions, suspends, configures and repairs tenants. */
  OPERATOR: 'OPERATOR',
  /** Helps tenants: reads everything and finds records, but repairs nothing. */
  SUPPORT: 'SUPPORT',
  /** Read-only. */
  VIEWER: 'VIEWER',
} as const;
export type PlatformRole = ValueOf<typeof PlatformRole>;

/**
 * The platform permission catalog. Every key is enforced by `@RequirePlatformPermissions` on the
 * platform's routes; it is a different type from the tenant catalog (`Permission`), so the two
 * cannot be mixed up.
 */
export const PLATFORM_PERMISSIONS = [
  /** Tenants, their locations, users, devices, modules, branding and domains. */
  'tenants.view',
  /** Create a tenant with its owner, locations and subdomain. */
  'tenants.provision',
  /** Suspend, reactivate or archive a tenant. */
  'tenants.status',
  /** Entitlements, and verifying a tenant's domains. */
  'tenants.configure',
  /** A tenant's payment provider accounts (never their secrets). */
  'tenants.payments.view',
  'health.view',
  /** The platform's audit log and every tenant's. */
  'audit.view',
  /** The support tools' searches. */
  'support.find',
  /** Preview and execute the support tools' repairs. */
  'support.repair',
  /** Releases, and the versions every tenant's devices run (ADR 0026). */
  'releases.view',
  /** Publish a release and change its notes or minimum versions. */
  'releases.publish',
  /** Put a tenant on a release channel, or pin it to a version. */
  'releases.rollout',
  /** Organizations (E1): their brands and members. */
  'organizations.view',
  /** Create an organization, change it, and bring brands and members in or out. */
  'organizations.manage',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export function isPlatformPermission(value: string): value is PlatformPermission {
  return (PLATFORM_PERMISSIONS as readonly string[]).includes(value);
}

const READ: readonly PlatformPermission[] = [
  'tenants.view',
  'tenants.payments.view',
  'health.view',
  'audit.view',
  'releases.view',
  'organizations.view',
];

/** What each role may do. Roles are fixed in code (there is no role editor for the platform). */
export const PLATFORM_ROLE_PERMISSIONS: Readonly<
  Record<PlatformRole, readonly PlatformPermission[]>
> = {
  OWNER: PLATFORM_PERMISSIONS,
  OPERATOR: PLATFORM_PERMISSIONS,
  SUPPORT: [...READ, 'support.find'],
  VIEWER: READ,
};

export function platformPermissionsOf(role: PlatformRole): readonly PlatformPermission[] {
  return PLATFORM_ROLE_PERMISSIONS[role];
}

// --- Support tools ------------------------------------------------------------------------------

/** What the support tools can look up inside one tenant. */
export const SupportFindKind = {
  ORDER: 'ORDER',
  CUSTOMER: 'CUSTOMER',
  PRODUCT: 'PRODUCT',
  PAYMENT: 'PAYMENT',
  SYNC_OPERATION: 'SYNC_OPERATION',
} as const;
export type SupportFindKind = ValueOf<typeof SupportFindKind>;

/**
 * The repairs (ADR 0025). Each is previewed first (tenant, record, before and after) and executed
 * only with the preview's confirmation, a reason and a role allowed for it. There is no free-form
 * data editing and no SQL console.
 */
export const SupportOperationKey = {
  /** Ask the location's hub to send a refused change again (ADR 0014 `RESEND`). */
  SYNC_RETRY: 'sync.retry',
  /** Apply a refused change from the hub (ADR 0014 `APPLY_HUB`). */
  SYNC_REPROCESS: 'sync.reprocess',
  /** Move an order by a SYSTEM rule of the order state machine; money guards still apply. */
  ORDER_STATUS: 'order.correct_status',
  /** Point an order line at the right catalog product; its name and price snapshot stay. */
  ORDER_ITEM_PRODUCT: 'order_item.correct_product',
  /** Recompute an open order's totals from its lines; a finalized order only gets the diff. */
  ORDER_TOTALS: 'order.recalculate_totals',
  /** Bring back an archived catalog or setup record. */
  RESTORE_ARCHIVED: 'entity.restore',
} as const;
export type SupportOperationKey = ValueOf<typeof SupportOperationKey>;

/** The roles that may execute each repair (on top of `support.repair`). */
export const SUPPORT_OPERATION_ROLES: Readonly<
  Record<SupportOperationKey, readonly PlatformRole[]>
> = {
  'sync.retry': ['OWNER', 'OPERATOR'],
  'sync.reprocess': ['OWNER', 'OPERATOR'],
  'order.correct_status': ['OWNER', 'OPERATOR'],
  'order_item.correct_product': ['OWNER', 'OPERATOR'],
  'order.recalculate_totals': ['OWNER', 'OPERATOR'],
  'entity.restore': ['OWNER', 'OPERATOR'],
};

/** Archived records the support tools can restore. */
export const RestorableEntity = {
  CATEGORY: 'CATEGORY',
  PRODUCT: 'PRODUCT',
  MODIFIER_GROUP: 'MODIFIER_GROUP',
  KITCHEN_STATION: 'KITCHEN_STATION',
  TAX: 'TAX',
  DISCOUNT: 'DISCOUNT',
  PAYMENT_METHOD: 'PAYMENT_METHOD',
  CASH_REGISTER: 'CASH_REGISTER',
} as const;
export type RestorableEntity = ValueOf<typeof RestorableEntity>;

/** How long a preview's confirmation can be used. */
export const SUPPORT_PREVIEW_TTL_SECONDS = 300;
