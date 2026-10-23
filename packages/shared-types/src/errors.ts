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
  // staff and devices (Phase 8)
  'USER_NOT_FOUND',
  'ROLE_NOT_FOUND',
  'EMPLOYEE_NOT_FOUND',
  'DEVICE_NOT_FOUND',
  // menu
  'CATEGORY_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'PRODUCT_UNAVAILABLE',
  'VARIANT_NOT_FOUND',
  'MODIFIER_GROUP_NOT_FOUND',
  'MODIFIER_NOT_FOUND',
  'INVALID_MODIFIER_SELECTION',
  'KITCHEN_STATION_NOT_FOUND',
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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Shape of every error response body returned by the API. */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
  requestId?: string;
}
