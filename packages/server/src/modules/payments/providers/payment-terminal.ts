import type { PaymentProvider, ProviderPaymentRequest, ProviderResult } from './payment-provider';

export interface TerminalChargeRequest extends ProviderPaymentRequest {
  /** The terminal device (a kiosk) whose card reader takes the payment. */
  deviceId: string;
}

export interface TerminalResult extends ProviderResult {
  /** The terminal's approval code, printed on the receipt. Never a card number. */
  reference: string | null;
}

/**
 * An integrated card terminal (ADR 0022): the card reader of a self-service kiosk, driven by the
 * server instead of a cashier typing its approval code (`ExternalCardPaymentProvider`). A charge
 * resolves once the customer has paid or the card was declined. The payment it produces touches
 * no cash drawer, so it is recorded with its device and no shift (a database CHECK allows exactly
 * that for CARD). Its refunds, taken at the POS later, go back through the same adapter (found by
 * the payment's `provider` name). No implementation may receive or store raw card data.
 */
export interface PaymentTerminalProvider extends PaymentProvider {
  readonly method: 'CARD';
  chargeAtTerminal(request: TerminalChargeRequest): Promise<TerminalResult>;
}

export const PAYMENT_TERMINAL = Symbol('PAYMENT_TERMINAL');
