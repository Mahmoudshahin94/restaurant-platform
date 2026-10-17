import { DomainError } from '@pos/domain';
import type { PaymentProvider, ProviderResult } from './payment-provider';

/**
 * Cash is settled the moment it is handed over: payments and refunds are captured immediately and
 * reconciled through the shift's cash drawer, not through a processor.
 */
export class CashPaymentProvider implements PaymentProvider {
  readonly name = 'cash';
  readonly method = 'CASH' as const;

  createPayment(): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef: null });
  }
  authorizePayment(): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef: null });
  }
  capturePayment(): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef: null });
  }
  cancelPayment(): Promise<ProviderResult> {
    // Handed-over cash cannot be "cancelled"; it is refunded instead.
    return Promise.reject(
      new DomainError('PAYMENT_FAILED', 'Cash payments are refunded, not cancelled', {
        reason: 'USE_REFUND',
      }),
    );
  }
  refundPayment(): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef: null });
  }
  getPaymentStatus(): Promise<ProviderResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef: null });
  }
}
