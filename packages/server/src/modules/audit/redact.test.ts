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

describe('redactForAudit and payment provider secrets (ADR 0024)', () => {
  it('redacts provider secrets under the names gateways use, and sealed bytes', () => {
    expect(
      redactForAudit({
        providerKey: 'mock-online',
        fingerprint: 'a1b2c3d4e5f6',
        secrets: { secretKey: 'sk_test_value' },
        apiKey: 'k1',
        api_key: 'k2',
        privateKey: 'k3',
        webhookSigningSecret: 'k4',
        clientSecret: 'k5',
        passphrase: 'k6',
        ciphertext: 'c',
        wrappedKey: 'w',
      }),
    ).toEqual({
      providerKey: 'mock-online',
      fingerprint: 'a1b2c3d4e5f6',
      secrets: '[REDACTED]',
      apiKey: '[REDACTED]',
      api_key: '[REDACTED]',
      privateKey: '[REDACTED]',
      webhookSigningSecret: '[REDACTED]',
      clientSecret: '[REDACTED]',
      passphrase: '[REDACTED]',
      ciphertext: '[REDACTED]',
      wrappedKey: '[REDACTED]',
    });
  });
});
