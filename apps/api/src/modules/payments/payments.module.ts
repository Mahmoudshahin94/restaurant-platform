import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CashPaymentProvider } from './providers/cash.provider';
import { ExternalCardPaymentProvider } from './providers/external-card.provider';
import { PAYMENT_PROVIDERS } from './providers/payment-provider';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { UnconfiguredOnlinePaymentProvider } from './providers/unconfigured-online.provider';

/** Payments: provider abstraction, charges, refunds. Swap or add providers here. */
@Module({
  controllers: [PaymentsController],
  providers: [
    {
      provide: PAYMENT_PROVIDERS,
      useValue: [
        new CashPaymentProvider(),
        new ExternalCardPaymentProvider(),
        new UnconfiguredOnlinePaymentProvider(),
      ],
    },
    PaymentProviderRegistry,
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
