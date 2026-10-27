import { describe, expect, it } from 'vitest';
import { CashPaymentProvider } from './cash.provider';
import { ExternalCardPaymentProvider } from './external-card.provider';
import { PAYMENT_PROVIDER_DEFINITIONS } from '@pos/validation';
import { PROVIDER_CATALOG, catalogEntry } from './catalog';
import { MockOnlinePaymentProvider } from './mock-online.provider';
import { MockPaymentTerminal } from './mock-terminal.provider';

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

  it('has an adapter for every provider definition, of the same name and method', () => {
    expect(Object.keys(PROVIDER_CATALOG).sort()).toEqual(
      Object.keys(PAYMENT_PROVIDER_DEFINITIONS).sort(),
    );
    for (const [key, entry] of Object.entries(PROVIDER_CATALOG)) {
      const adapter = entry.create({ mode: 'TEST', publicConfig: {}, secrets: {} });
      expect(adapter.name).toBe(key);
      // A kiosk terminal records CARD payments; every other method is its own tender type.
      expect(entry.definition.method === 'TERMINAL' ? 'CARD' : entry.definition.method).toBe(
        adapter.method,
      );
      // An adapter that needs secrets cannot run on a hub, which never holds them.
      if (entry.definition.secrets) expect(entry.definition.runsOn).toBe('cloud');
    }
    expect(catalogEntry('stripe')).toBeNull();
    expect(catalogEntry('__proto__')).toBeNull();
  });

  it('builds adapters from their account settings', () => {
    const online = PROVIDER_CATALOG['mock-online'].create({
      mode: 'TEST',
      publicConfig: { statementDescriptor: 'DEMO KITCHEN' },
      secrets: { secretKey: 'sk_test_12345678' },
    });
    expect(online).toBeInstanceOf(MockOnlinePaymentProvider);
    expect((online as MockOnlinePaymentProvider).hasSecretKey).toBe(true);
    expect((online as MockOnlinePaymentProvider).statementDescriptor).toBe('DEMO KITCHEN');
    const terminal = PROVIDER_CATALOG['mock-terminal'].create({
      mode: 'TEST',
      publicConfig: { terminalLabel: 'Kiosk reader 1' },
      secrets: {},
    });
    expect((terminal as MockPaymentTerminal).label).toBe('Kiosk reader 1');
  });

  it('validates configuration and secrets strictly', () => {
    const online = PAYMENT_PROVIDER_DEFINITIONS['mock-online'];
    expect(online.secrets?.safeParse({ secretKey: 'sk_live_12345678' }).success).toBe(false);
    expect(online.secrets?.safeParse({ secretKey: 'sk_test_12345678', extra: 'x' }).success).toBe(
      false,
    );
    expect(online.publicConfig.safeParse({ secretKey: 'sk_test_12345678' }).success).toBe(false);
    expect(online.modes).toEqual(['TEST']);
    expect(online.devOnly).toBe(true);
  });

  it('approves kiosk charges with an approval code, idempotently, and declines on request', async () => {
    const terminal = new MockPaymentTerminal();
    const charge = { ...request, deviceId: 'kiosk-1' };
    const first = await terminal.chargeAtTerminal(charge);
    expect(first.status).toBe('CAPTURED');
    expect(first.reference).toMatch(/^MT\d{6}$/);
    await expect(terminal.chargeAtTerminal(charge)).resolves.toEqual(first);
    MockPaymentTerminal.declineNext();
    await expect(terminal.chargeAtTerminal({ ...charge, paymentId: 'p2' })).resolves.toMatchObject({
      status: 'FAILED',
      reference: null,
    });
    await expect(terminal.chargeAtTerminal({ ...charge, paymentId: 'p3' })).resolves.toMatchObject({
      status: 'CAPTURED',
    });
  });
});
