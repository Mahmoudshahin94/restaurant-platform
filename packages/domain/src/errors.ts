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

/**
 * Recognises a DomainError by shape as well as by class: a process can load this package twice
 * (its ESM and CJS builds, e.g. an app under test and a compiled server package), giving two
 * DomainError classes whose errors must be handled the same way.
 */
export function isDomainError(error: unknown): error is DomainError {
  if (error instanceof DomainError) return true;
  if (!(error instanceof Error) || error.name !== 'DomainError') return false;
  const candidate = error as { code?: unknown; details?: unknown };
  return typeof candidate.code === 'string' && typeof candidate.details === 'object';
}
