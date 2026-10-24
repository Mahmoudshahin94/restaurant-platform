import { describe, expect, it } from 'vitest';
import { CashPaymentProvider } from './cash.provider';
import { ExternalCardPaymentProvider } from './external-card.provider';
import { MockPaymentTerminal } from './mock-terminal.provider';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { UnconfiguredOnlinePaymentProvider } from './unconfigured-online.provider';
import { UnconfiguredPaymentTerminal } from './unconfigured-terminal.provider';

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

  it('resolves providers by method type, and a recorded payment by its provider', () => {
    const registry = new PaymentProviderRegistry(
      [new CashPaymentProvider(), new ExternalCardPaymentProvider()],
      new MockPaymentTerminal(),
    );
    expect(registry.for('CARD').name).toBe('external-card');
    expect(() => registry.for('ONLINE')).toThrow();
    // A kiosk's card payment is refunded through its terminal, not as a typed approval code.
    expect(registry.of({ provider: 'mock-terminal', methodType: 'CARD' }).name).toBe(
      'mock-terminal',
    );
    expect(registry.of({ provider: 'retired-adapter', methodType: 'CARD' }).name).toBe(
      'external-card',
    );
  });

  it('approves kiosk charges with an approval code, idempotently, and declines on request', async () => {
    const terminal = new MockPaymentTerminal();
    const charge = { ...request, deviceId: 'kiosk-1' };
    const first = await terminal.chargeAtTerminal(charge);
    expect(first).toMatchObject({
      status: 'CAPTURED',
      reference: expect.stringMatching(/^MT\d{6}$/),
    });
    await expect(terminal.chargeAtTerminal(charge)).resolves.toEqual(first);
    terminal.declineNext();
    await expect(terminal.chargeAtTerminal({ ...charge, paymentId: 'p2' })).resolves.toMatchObject({
      status: 'FAILED',
      reference: null,
    });
    await expect(terminal.chargeAtTerminal({ ...charge, paymentId: 'p3' })).resolves.toMatchObject({
      status: 'CAPTURED',
    });
  });

  it('refuses kiosk card payments when no terminal is configured', async () => {
    await expect(new UnconfiguredPaymentTerminal().chargeAtTerminal()).rejects.toMatchObject({
      details: { reason: 'PROVIDER_NOT_CONFIGURED' },
    });
  });
});
