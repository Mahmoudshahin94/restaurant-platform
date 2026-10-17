import { DomainError } from '@pos/domain';
import type { PaymentProvider, ProviderPaymentRequest, ProviderResult } from './payment-provider';

/**
 * Card payments approved on a standalone terminal (not integrated with the POS). The cashier
 * charges the card on the terminal and records its approval code here; this adapter only
 * records the outcome. An integrated terminal (e.g. a vendor SDK) would be a new provider that
 * drives the terminal and returns its transaction id. Refunds are likewise performed on the
 * terminal and recorded here.
 */
export class ExternalCardPaymentProvider implements PaymentProvider {
  readonly name = 'external-card';
  readonly method = 'CARD' as const;

  createPayment(request: ProviderPaymentRequest): Promise<ProviderResult> {
    if (!request.reference) {
      return Promise.reject(
        new DomainError('PAYMENT_FAILED', 'Enter the approval code from the card terminal', {
          reason: 'REFERENCE_REQUIRED',
        }),
      );
    }
    return Promise.resolve({ status: 'CAPTURED', providerRef: request.reference });
  }
  authorizePayment(providerRef: string): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef });
  }
  capturePayment(providerRef: string): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef });
  }
  cancelPayment(providerRef: string): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CANCELLED', providerRef });
  }
  refundPayment(): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef: null });
  }
  getPaymentStatus(providerRef: string): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef });
  }
}
