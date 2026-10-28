import { describe, expect, it } from 'vitest';
import { ErrorSampler, redactErrorMessage } from './error-events';

describe('error events for the health board (ADR 0025)', () => {
  it('keeps a few errors per route and code each minute, counting the rest', () => {
    const sampler = new ErrorSampler(2);
    const at = 1_000_000;
    expect(sampler.admit('GET /a INTERNAL_ERROR', at)).toEqual({ keep: true, suppressed: 0 });
    expect(sampler.admit('GET /a INTERNAL_ERROR', at + 1)).toEqual({ keep: true, suppressed: 0 });
    expect(sampler.admit('GET /a INTERNAL_ERROR', at + 2).keep).toBe(false);
    expect(sampler.admit('GET /a INTERNAL_ERROR', at + 3).keep).toBe(false);
    // Another route is not crowded out.
    expect(sampler.admit('GET /b INTERNAL_ERROR', at + 4).keep).toBe(true);
    // The next minute's first event says how many were dropped.
    expect(sampler.admit('GET /a INTERNAL_ERROR', at + 60_000)).toEqual({
      keep: true,
      suppressed: 2,
    });
  });

  it('keeps nothing when sampling is off', () => {
    expect(new ErrorSampler(0).admit('k').keep).toBe(false);
  });

  it('redacts e-mails, phone and card numbers and credentials, keeping record ids', () => {
    const id = '01a181fb-57a6-7641-b52b-0dd3c4d367e7';
    const message = redactErrorMessage(
      `Error: order ${id} of jane@example.com +970 599 123 456 card 4242424242424242 ` +
        'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig Device 0193.secretpart',
    );
    expect(message).toContain(id);
    expect(message).not.toMatch(/jane|599 123|4242|eyJ|secretpart/);
    expect(redactErrorMessage('word '.repeat(200))).toHaveLength(500);
  });
});
