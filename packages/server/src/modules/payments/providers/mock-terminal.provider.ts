import { createHash } from 'node:crypto';
import type { ProviderRefundRequest, ProviderResult } from './payment-provider';
import type {
  PaymentTerminalProvider,
  TerminalChargeRequest,
  TerminalResult,
} from './payment-terminal';

/**
 * The documented TEST adapter for kiosk card terminals (ADR 0022): it stands in for a vendor's
 * terminal SDK so the whole self-service flow can be built and tested without hardware. Every
 * charge is approved at once with a made-up approval code, unless a test asked for declines
 * (`declineNext`). Refused in production (`PAYMENT_TERMINAL_PROVIDER=mock` fails configuration
 * there); it moves no money.
 *
 * State lives in memory, keyed by our payment id, so a retried charge is idempotent within one
 * process; a real terminal keeps it on its side.
 */
export class MockPaymentTerminal implements PaymentTerminalProvider {
  readonly name = 'mock-terminal';
  readonly method = 'CARD' as const;
  private readonly payments = new Map<string, ProviderResult['status']>();
  private declines = 0;

  /** Test helper: the next `count` charges are declined, as if the card were refused. */
  declineNext(count = 1): void {
    this.declines += count;
  }

  private ref(paymentId: string): string {
    return `mockterm_${createHash('sha256').update(paymentId).digest('hex').slice(0, 20)}`;
  }

  chargeAtTerminal(request: TerminalChargeRequest): Promise<TerminalResult> {
    const providerRef = this.ref(request.paymentId);
    const known = this.payments.get(providerRef);
    let status = known;
    if (!status) {
      status = this.declines > 0 ? 'FAILED' : 'CAPTURED';
      if (this.declines > 0) this.declines -= 1;
      this.payments.set(providerRef, status);
    }
    const reference =
      status === 'CAPTURED'
        ? `MT${String(parseInt(providerRef.slice(-6), 16) % 1_000_000).padStart(6, '0')}`
        : null;
    return Promise.resolve({ status, providerRef, reference });
  }

  createPayment(request: TerminalChargeRequest): Promise<ProviderResult> {
    return this.chargeAtTerminal(request);
  }

  authorizePayment(providerRef: string): Promise<ProviderResult> {
    return this.getPaymentStatus(providerRef);
  }

  capturePayment(providerRef: string): Promise<ProviderResult> {
    return this.getPaymentStatus(providerRef);
  }

  /** Voids a charge before settlement (the order could not take it): nothing is collected. */
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
