import type { ErrorCode } from '@pos/shared-types';

/** Transport mapping for domain error codes. Exhaustive: adding a code without a status fails typecheck. */
export const HTTP_STATUS_BY_ERROR_CODE = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_REUSED: 401,
  ACCOUNT_DISABLED: 403,
  INSUFFICIENT_PERMISSION: 403,
  CSRF_REJECTED: 403,
  RESTAURANT_NOT_FOUND: 404,
  LOCATION_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  PRODUCT_UNAVAILABLE: 422,
  VARIANT_NOT_FOUND: 404,
  MODIFIER_GROUP_NOT_FOUND: 404,
  MODIFIER_NOT_FOUND: 404,
  INVALID_MODIFIER_SELECTION: 422,
  KITCHEN_STATION_NOT_FOUND: 404,
  INVALID_MONEY_AMOUNT: 422,
  UNSUPPORTED_CURRENCY: 422,
  ORDER_NOT_FOUND: 404,
  INVALID_ORDER_STATE: 409,
  PAYMENT_FAILED: 402,
  SYNC_CONFLICT: 409,
  DUPLICATE_OPERATION: 409,
  RESTAURANT_OFFLINE: 503,
  ONLINE_ORDERING_DISABLED: 409,
} as const satisfies Record<ErrorCode, number>;

export function errorCodeForHttpStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 413:
    case 415:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'INSUFFICIENT_PERMISSION';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}
