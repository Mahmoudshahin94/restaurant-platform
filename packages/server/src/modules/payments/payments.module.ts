import { Module } from '@nestjs/common';
import { SERVER_MODE, type ServerMode } from '../../common/auth/managed-in-cloud';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { NO_KEYS, PAYMENT_KEY_PROVIDER, createKeyProvider } from './secrets/key-provider';
import { PaymentSecretsService } from './secrets/payment-secrets.service';

/**
 * Payments: charges and refunds, and the providers that take them (ADR 0024): each tenant's
 * provider accounts pick and configure an adapter of the provider catalog. Add providers to the
 * catalog, not here.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    {
      // The cloud seals provider secrets; it refuses to start in production without a key.
      provide: PAYMENT_KEY_PROVIDER,
      inject: [APP_CONFIG, SERVER_MODE],
      useFactory: (config: AppConfig, mode: ServerMode) =>
        mode === 'cloud' ? createKeyProvider(config) : NO_KEYS,
    },
    PaymentSecretsService,
    PaymentProviderFactory,
    PaymentsService,
  ],
  exports: [PaymentsService, PaymentProviderFactory, PaymentSecretsService],
})
export class PaymentsModule {}
