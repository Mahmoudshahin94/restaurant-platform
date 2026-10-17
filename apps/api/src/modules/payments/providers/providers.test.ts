import { describe, expect, it } from 'vitest';
import { CashPaymentProvider } from './cash.provider';
import { ExternalCardPaymentProvider } from './external-card.provider';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { UnconfiguredOnlinePaymentProvider } from './unconfigured-online.provider';

const request = { paymentId: 'p', orderId: 'o', amount: 100, currency: 'SAR', reference: null };

describe('payment providers', () => {
  it('captures cash immediately and refuses to cancel it', async () => {
    const cash = new CashPaymentProvider();
    await expect(cash.createPayment()).resolves.toEqual({ status: 'CAPTURED', providerRef: null });
    await expect(cash.cancelPayment()).rejects.toMatchObject({
      code: 'PAYMENT_FAILED',
      details: { reason: 'USE_REFUND' },
    });
  });

  it('records external card approvals and requires the approval code', async () => {
    const card = new ExternalCardPaymentProvider();
    await expect(card.createPayment(request)).rejects.toMatchObject({
      details: { reason: 'REFERENCE_REQUIRED' },
    });
    await expect(card.createPayment({ ...request, reference: 'A1B2C3' })).resolves.toEqual({
      status: 'CAPTURED',
      providerRef: 'A1B2C3',
    });
  });

  it('never pretends an unconfigured online gateway succeeded', async () => {
    await expect(new UnconfiguredOnlinePaymentProvider().createPayment()).rejects.toMatchObject({
      details: { reason: 'PROVIDER_NOT_CONFIGURED' },
    });
  });

  it('resolves providers by method type', () => {
    const registry = new PaymentProviderRegistry([
      new CashPaymentProvider(),
      new ExternalCardPaymentProvider(),
    ]);
    expect(registry.for('CARD').name).toBe('external-card');
    expect(() => registry.for('ONLINE')).toThrow();
  });
});
