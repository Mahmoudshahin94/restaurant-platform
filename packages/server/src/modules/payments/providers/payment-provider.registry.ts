import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { PaymentMethodType } from '@pos/shared-types';
import { PAYMENT_PROVIDERS, type PaymentProvider } from './payment-provider';

/** Resolves the provider for a payment method type. Configured in PaymentsModule. */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byMethod: Map<PaymentMethodType, PaymentProvider>;

  constructor(@Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[]) {
    this.byMethod = new Map(providers.map((p) => [p.method, p]));
  }

  for(method: PaymentMethodType): PaymentProvider {
    const provider = this.byMethod.get(method);
    if (!provider)
      throw new DomainError('PAYMENT_FAILED', 'No provider for this payment method', {
        reason: 'PROVIDER_NOT_CONFIGURED',
        method,
      });
    return provider;
  }
}
