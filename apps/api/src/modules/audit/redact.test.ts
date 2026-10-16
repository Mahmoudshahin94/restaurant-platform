import { describe, expect, it } from 'vitest';
import { redactForAudit } from './redact';

describe('redactForAudit', () => {
  it('redacts sensitive keys at any depth and keeps the rest', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(
      redactForAudit({
        email: 'a@b.c',
        password: 'x',
        nested: { refreshToken: 'y', pinHash: 'z', price: 1850 },
        list: [{ cardNumber: '4111' }],
        at,
      }),
    ).toEqual({
      email: 'a@b.c',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', pinHash: '[REDACTED]', price: 1850 },
      list: [{ cardNumber: '[REDACTED]' }],
      at: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('redactForAudit key matching', () => {
  it('does not redact innocent keys that contain short sensitive fragments', () => {
    expect(redactForAudit({ shippingFee: 100, company: 'x', pin: '1234' })).toEqual({
      shippingFee: 100,
      company: 'x',
      pin: '[REDACTED]',
    });
  });
});
