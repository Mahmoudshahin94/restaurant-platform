import type { ErrorCode } from '@pos/shared-types';

/**
 * A business-rule violation with a stable code. Thrown by domain and application services;
 * the API maps it to an HTTP status and the error envelope, and the UIs localize it via
 * `errors.<code>`.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
