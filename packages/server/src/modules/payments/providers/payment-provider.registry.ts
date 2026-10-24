import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { PaymentMethodType } from '@pos/shared-types';
import { PAYMENT_PROVIDERS, type PaymentProvider } from './payment-provider';
import { PAYMENT_TERMINAL, type PaymentTerminalProvider } from './payment-terminal';

/** Resolves the provider for a payment method type. Configured in PaymentsModule. */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byMethod: Map<PaymentMethodType, PaymentProvider>;
  private readonly byName: Map<string, PaymentProvider>;

  constructor(
    @Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[],
    @Inject(PAYMENT_TERMINAL) readonly terminal: PaymentTerminalProvider,
  ) {
    this.byMethod = new Map(providers.map((p) => [p.method, p]));
    this.byName = new Map([...providers, terminal].map((p) => [p.name, p]));
  }

  /** The provider that takes new payments of a method at the POS. */
  for(method: PaymentMethodType): PaymentProvider {
    const provider = this.byMethod.get(method);
    if (!provider)
      throw new DomainError('PAYMENT_FAILED', 'No provider for this payment method', {
        reason: 'PROVIDER_NOT_CONFIGURED',
        method,
      });
    return provider;
  }

  /**
   * The provider that processed a recorded payment (its `provider` name), so its refund goes back
   * the same way (a kiosk's card terminal); the method's provider when the name is unknown.
   */
  of(payment: { provider: string; methodType: PaymentMethodType }): PaymentProvider {
    return this.byName.get(payment.provider) ?? this.for(payment.methodType);
  }
}
