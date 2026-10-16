import { ERROR_CODES, type ErrorCode } from '@pos/shared-types';

/** Client-side failures that never come from the server. Translated under `errors:<code>` too. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | ClientErrorCode,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toApiError(status: number, body: unknown): ApiError {
  if (
    isRecord(body) &&
    typeof body.code === 'string' &&
    (ERROR_CODES as readonly string[]).includes(body.code)
  ) {
    return new ApiError(
      body.code as ErrorCode,
      typeof body.message === 'string' ? body.message : body.code,
      status,
      isRecord(body.details) ? body.details : {},
      typeof body.requestId === 'string' ? body.requestId : undefined,
    );
  }
  return new ApiError('INVALID_RESPONSE', `Unexpected ${status} response`, status);
}
