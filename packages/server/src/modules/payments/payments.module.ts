import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CashPaymentProvider } from './providers/cash.provider';
import { ExternalCardPaymentProvider } from './providers/external-card.provider';
import { MockPaymentTerminal } from './providers/mock-terminal.provider';
import { PAYMENT_PROVIDERS } from './providers/payment-provider';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { PAYMENT_TERMINAL, type PaymentTerminalProvider } from './providers/payment-terminal';
import { UnconfiguredOnlinePaymentProvider } from './providers/unconfigured-online.provider';
import { UnconfiguredPaymentTerminal } from './providers/unconfigured-terminal.provider';

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
    {
      // Kiosk card terminals (ADR 0022): one adapter per installation, chosen by configuration.
      provide: PAYMENT_TERMINAL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PaymentTerminalProvider =>
        config.PAYMENT_TERMINAL_PROVIDER === 'mock'
          ? new MockPaymentTerminal()
          : new UnconfiguredPaymentTerminal(),
    },
    PaymentProviderRegistry,
    PaymentsService,
  ],
  exports: [PaymentsService, PAYMENT_TERMINAL],
})
export class PaymentsModule {}
