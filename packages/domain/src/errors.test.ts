import { describe, expect, it } from 'vitest';
import { DomainError, isDomainError } from './errors';

describe('isDomainError', () => {
  it('recognises domain errors, including ones from another copy of this package', () => {
    expect(isDomainError(new DomainError('ORDER_NOT_FOUND', 'x'))).toBe(true);

    // What a DomainError from the package's other build (ESM vs CJS) looks like.
    class ForeignDomainError extends Error {
      readonly code = 'ORDER_NOT_FOUND';
      readonly details = {};
      override name = 'DomainError';
    }
    expect(isDomainError(new ForeignDomainError('x'))).toBe(true);
  });

  it('rejects other errors and look-alikes without a code', () => {
    expect(isDomainError(new Error('x'))).toBe(false);
    const named = new Error('x');
    named.name = 'DomainError';
    expect(isDomainError(named)).toBe(false);
    expect(isDomainError({ name: 'DomainError', code: 'X', details: {} })).toBe(false);
  });
});
