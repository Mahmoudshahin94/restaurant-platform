/**
 * Stable machine-readable error codes. Clients branch on `code` and localize the message
 * themselves (translation key `errors.<CODE>`); the server `message` is for developers only.
 */
export const ERROR_CODES = [
  // generic
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  /** A dependency (the database) is unavailable; `/ready` answers it. */
  'SERVICE_UNAVAILABLE',
  // auth
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'TOKEN_REUSED',
  'ACCOUNT_DISABLED',
  'INSUFFICIENT_PERMISSION',
  'CSRF_REJECTED',
  // tenancy
  'TENANT_NOT_FOUND',
  'LOCATION_NOT_FOUND',
  /** The platform suspended the business: its staff, hubs and website are refused (ADR 0025). */
  'TENANT_SUSPENDED',
  /** The business is archived: it can be read, not changed (ADR 0025). */
  'TENANT_ARCHIVED',
  // versions (ADR 0026)
  /** The app is older than the cloud supports: update it (details.minimumVersion, details.version). */
  'CLIENT_UPGRADE_REQUIRED',
  /** The location hub is older than the cloud supports: it must be updated before it syncs again. */
  'HUB_UPGRADE_REQUIRED',
  'RELEASE_NOT_FOUND',
  // modules (ADR 0018)
  /** The route or action needs a module that is off for this tenant, location or device. */
  'FEATURE_DISABLED',
  /** The module is not the tenant's to switch: not in its plan, or managed by the platform. */
  'FEATURE_NOT_CONFIGURABLE',
  // branding and tenant files (ADR 0019)
  /** No such file of this tenant (another tenant's file is not found either). */
  'FILE_NOT_FOUND',
  /** Not a PNG, JPEG, WebP or ICO image, or the bytes are not the declared type. */
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_TOO_LARGE',
  /** A brand colour would make text or controls unreadable (details.issues). */
  'BRANDING_UNREADABLE',
  // the tenant's website and domains (ADR 0023)
  /** No verified domain of any tenant answers to this host name. */
  'SITE_NOT_FOUND',
  'DOMAIN_NOT_FOUND',
  /** Not a domain name a website can be served on (details.reason). */
  'DOMAIN_INVALID',
  /** Another tenant already serves its website on this domain. */
  'DOMAIN_TAKEN',
  /** The `_madar-verify` TXT record was not found or does not hold the domain's token. */
  'DOMAIN_NOT_VERIFIED',
  /** The platform address, or the primary domain, cannot be disabled (details.reason). */
  'DOMAIN_LOCKED',
  // staff and devices (Phase 8)
  'USER_NOT_FOUND',
  'ROLE_NOT_FOUND',
  'EMPLOYEE_NOT_FOUND',
  'DEVICE_NOT_FOUND',
  /** No terminal waits for this pairing code at this hub, or it expired (ADR 0022). */
  'PAIRING_CODE_INVALID',
  // menu
  'CATEGORY_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'PRODUCT_UNAVAILABLE',
  'VARIANT_NOT_FOUND',
  'MODIFIER_GROUP_NOT_FOUND',
  'MODIFIER_NOT_FOUND',
  'INVALID_MODIFIER_SELECTION',
  'KITCHEN_STATION_NOT_FOUND',
  // retail catalog (ADR 0021)
  /** No product or variant of this location's menu has this barcode (or SKU). */
  'BARCODE_NOT_FOUND',
  /** Not a valid code of its symbology: wrong length, characters or check digit (details.reason). */
  'BARCODE_INVALID',
  /** Another product or variant of the tenant already has this barcode (details.code). */
  'BARCODE_TAKEN',
  /** Another product or variant of the tenant already has this SKU (details.sku). */
  'SKU_TAKEN',
  /** The variants do not match the product's options (details.reason). */
  'INVALID_VARIANT_OPTIONS',
  // money
  'INVALID_MONEY_AMOUNT',
  'UNSUPPORTED_CURRENCY',
  // orders / payments
  'ORDER_NOT_FOUND',
  'TABLE_NOT_FOUND',
  'TAX_NOT_FOUND',
  'DISCOUNT_NOT_FOUND',
  'INVALID_ORDER_STATE',
  'PAYMENT_FAILED',
  'PAYMENT_NOT_FOUND',
  'REFUND_NOT_ALLOWED',
  'SHIFT_NOT_FOUND',
  'SHIFT_NOT_OPEN',
  'SHIFT_ALREADY_OPEN',
  'CASH_REGISTER_NOT_FOUND',
  'PAYMENT_METHOD_NOT_FOUND',
  // payment configuration (ADR 0024)
  'PAYMENT_PROVIDER_NOT_FOUND',
  /**
   * The provider does not fit: unknown, not for this method or mode, its configuration or secrets
   * do not match its schema, or a test adapter in production (details.reason, details.issues).
   */
  'PAYMENT_PROVIDER_INVALID',
  /** The business takes no online card payments here: pay at pickup or on delivery. */
  'ONLINE_PAYMENT_UNAVAILABLE',
  // kitchen
  'KITCHEN_TICKET_NOT_FOUND',
  'INVALID_TICKET_STATE',
  // location hub
  'MANAGED_IN_CLOUD',
  'HUB_NOT_PROVISIONED',
  // sync / online ordering
  'SYNC_CONFLICT',
  'SYNC_REJECTED',
  'SYNC_SCOPE_MISMATCH',
  'SYNC_DEPENDENCY_MISSING',
  'SYNC_UNAVAILABLE',
  'SYNC_SUPERSEDED',
  'DUPLICATE_OPERATION',
  'SYNC_ISSUE_NOT_FOUND',
  'LOCATION_OFFLINE',
  'ONLINE_ORDERING_DISABLED',
  // platform support tools (ADR 0025)
  /** No preview of this operation, target and operator matches the confirmation (details.reason). */
  'SUPPORT_CONFIRMATION_INVALID',
  /** The record changed since the preview, or the preview expired: preview again. */
  'SUPPORT_PREVIEW_STALE',
  /** The preview shows what is wrong, but this operation may not change it (details.reason). */
  'SUPPORT_NOT_EXECUTABLE',
  // organizations (E1)
  'ORGANIZATION_NOT_FOUND',
  /** A brand's currency differs from its organization's: one currency per organization. */
  'ORGANIZATION_CURRENCY_MISMATCH',
  /** The change would leave an organization without an owner. */
  'ORGANIZATION_LAST_OWNER',
  /** The user belongs to an organization, which manages their access instead of the brand. */
  'USER_MANAGED_BY_ORGANIZATION',
  'ORGANIZATION_SLUG_TAKEN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Shape of every error response body returned by the API. */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
  requestId?: string;
}
