import { describe, expect, it } from 'vitest';
import { MockOnlinePaymentProvider } from '../payments/providers/mock-online.provider';
import { TrackingTokens, trackingSecret } from './tracking-token';

describe('tracking tokens', () => {
  const tokens = new TrackingTokens('x'.repeat(40));
  const orderId = '0199e4a0-0000-7000-8000-000000000001';

  it('round-trips an order id and refuses tampering', () => {
    const token = tokens.issue(orderId);
    expect(tokens.verify(token)).toBe(orderId);
    expect(tokens.verify(`${token}x`)).toBeNull();
    expect(tokens.verify(token.replace('0001.', '0002.'))).toBeNull();
    expect(tokens.verify('not-a-token')).toBeNull();
    expect(tokens.verify(`${orderId}.`)).toBeNull();
    // Another key signs differently.
    expect(new TrackingTokens('y'.repeat(40)).verify(token)).toBeNull();
  });

  it('derives its key from the access-token key unless one is configured', () => {
    const a = trackingSecret({ JWT_ACCESS_SECRET: 'a'.repeat(40) });
    expect(a).not.toBe('a'.repeat(40));
    expect(trackingSecret({ JWT_ACCESS_SECRET: 'a'.repeat(40), TRACKING_TOKEN_SECRET: 'k' })).toBe(
      'k',
    );
  });
});

describe('mock online card adapter', () => {
  const request = { paymentId: 'p1', orderId: 'o1', amount: 1000, currency: 'SAR' };

  it('captures approved test tokens idempotently and declines the decline token', async () => {
    const mock = new MockOnlinePaymentProvider();
    const first = await mock.createPayment({ ...request, reference: 'tok_mock_visa' });
    expect(first.status).toBe('CAPTURED');
    expect(await mock.createPayment({ ...request, reference: 'tok_mock_visa' })).toEqual(first);
    expect(
      (await mock.createPayment({ ...request, paymentId: 'p2', reference: 'tok_mock_decline' }))
        .status,
    ).toBe('FAILED');
    await expect(
      mock.createPayment({ ...request, reference: '4111111111111111' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_FAILED', details: { reason: 'INVALID_TOKEN' } });
  });

  it('voids a charge', async () => {
    const mock = new MockOnlinePaymentProvider();
    const { providerRef } = await mock.createPayment({ ...request, reference: 'tok_mock_visa' });
    expect(await mock.cancelPayment(providerRef ?? '')).toMatchObject({ status: 'CANCELLED' });
    expect((await mock.getPaymentStatus(providerRef ?? '')).status).toBe('CANCELLED');
  });
});
