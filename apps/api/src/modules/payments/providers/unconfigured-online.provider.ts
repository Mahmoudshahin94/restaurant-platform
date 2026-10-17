import { DomainError } from '@pos/domain';
import type { PaymentProvider, ProviderResult } from './payment-provider';

/**
 * Placeholder for an online payment gateway (customer website, Phase 7). It refuses every
 * operation with an explicit error, so ONLINE methods cannot be used until a real gateway
 * adapter is configured. Nothing here pretends a payment succeeded.
 */
export class UnconfiguredOnlinePaymentProvider implements PaymentProvider {
  readonly name = 'online-unconfigured';
  readonly method = 'ONLINE' as const;

  private refuse(): Promise<ProviderResult> {
    return Promise.reject(
      new DomainError('PAYMENT_FAILED', 'No online payment gateway is configured', {
        reason: 'PROVIDER_NOT_CONFIGURED',
      }),
    );
  }
  createPayment(): Promise<ProviderResult> {
    return this.refuse();
  }
  authorizePayment(): Promise<ProviderResult> {
    return this.refuse();
  }
  capturePayment(): Promise<ProviderResult> {
    return this.refuse();
  }
  cancelPayment(): Promise<ProviderResult> {
    return this.refuse();
  }
  refundPayment(): Promise<ProviderResult> {
    return this.refuse();
  }
  getPaymentStatus(): Promise<ProviderResult> {
    return this.refuse();
  }
}
