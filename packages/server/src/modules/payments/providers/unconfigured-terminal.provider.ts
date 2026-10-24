import { DomainError } from '@pos/domain';
import type { ProviderResult } from './payment-provider';
import type { PaymentTerminalProvider, TerminalResult } from './payment-terminal';

/**
 * No kiosk card terminal is configured (`PAYMENT_TERMINAL_PROVIDER=none`): every operation is
 * refused with an explicit error, so kiosk customers pay at the counter. Nothing here pretends a
 * payment succeeded.
 */
export class UnconfiguredPaymentTerminal implements PaymentTerminalProvider {
  readonly name = 'terminal-unconfigured';
  readonly method = 'CARD' as const;

  private refuse<T>(): Promise<T> {
    return Promise.reject(
      new DomainError('PAYMENT_FAILED', 'No card terminal is configured', {
        reason: 'PROVIDER_NOT_CONFIGURED',
      }),
    );
  }

  chargeAtTerminal(): Promise<TerminalResult> {
    return this.refuse();
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
