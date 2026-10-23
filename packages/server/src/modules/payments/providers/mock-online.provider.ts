import { createHash } from 'node:crypto';
import { DomainError } from '@pos/domain';
import type {
  PaymentProvider,
  ProviderPaymentRequest,
  ProviderRefundRequest,
  ProviderResult,
} from './payment-provider';

/**
 * The documented TEST adapter for online card payments on the customer website (ADR 0013). It
 * stands in for a real gateway (its browser SDK turns the card into a token; the server charges
 * the token) so the whole flow can be built and tested without one. It is refused in production
 * (`ONLINE_PAYMENT_PROVIDER=mock` fails configuration there) and moves no money.
 *
 * Test tokens: `tok_mock_decline…` is declined; any other `tok_mock_…` is approved. The charge is
 * captured at once (the customer pays when ordering); an order the location rejects, or does not
 * accept in time, is voided.
 *
 * State lives in memory, keyed by our payment id, so a retried charge is idempotent within one
 * process; a real gateway keeps it on its side.
 */
export class MockOnlinePaymentProvider implements PaymentProvider {
  readonly name = 'mock-online';
  readonly method = 'ONLINE' as const;
  private readonly payments = new Map<string, ProviderResult['status']>();

  private ref(paymentId: string): string {
    return `mock_${createHash('sha256').update(paymentId).digest('hex').slice(0, 24)}`;
  }

  createPayment(request: ProviderPaymentRequest): Promise<ProviderResult> {
    const token = request.reference ?? '';
    if (!token.startsWith('tok_mock_')) {
      return Promise.reject(
        new DomainError('PAYMENT_FAILED', 'Unknown card token', { reason: 'INVALID_TOKEN' }),
      );
    }
    const providerRef = this.ref(request.paymentId);
    if (token.startsWith('tok_mock_decline')) {
      this.payments.set(providerRef, 'FAILED');
      return Promise.resolve({ status: 'FAILED', providerRef });
    }
    if (!this.payments.has(providerRef)) this.payments.set(providerRef, 'CAPTURED');
    return Promise.resolve({ status: this.payments.get(providerRef) ?? 'CAPTURED', providerRef });
  }

  authorizePayment(providerRef: string): Promise<ProviderResult> {
    return this.getPaymentStatus(providerRef);
  }

  capturePayment(providerRef: string): Promise<ProviderResult> {
    return this.getPaymentStatus(providerRef);
  }

  /** Voids a charge (before settlement): the customer is never charged. */
  cancelPayment(providerRef: string): Promise<ProviderResult> {
    this.payments.set(providerRef, 'CANCELLED');
    return Promise.resolve({ status: 'CANCELLED', providerRef });
  }

  refundPayment(request: ProviderRefundRequest): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef: request.providerRef });
  }

  getPaymentStatus(providerRef: string): Promise<ProviderResult> {
    return Promise.resolve({ status: this.payments.get(providerRef) ?? 'FAILED', providerRef });
  }
}
