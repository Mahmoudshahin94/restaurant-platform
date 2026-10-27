import type { PaymentMethodType, PaymentRecordStatus } from '@pos/shared-types';

export interface ProviderPaymentRequest {
  /** Our payment id; providers that support it use it as their idempotency key. */
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  /** Card approval code / terminal receipt number, when the method needs one. */
  reference: string | null;
}

export interface ProviderRefundRequest {
  refundId: string;
  /** The provider's id of the charge being refunded (null for cash). */
  providerRef: string | null;
  amount: number;
  currency: string;
}

export interface ProviderResult {
  status: PaymentRecordStatus;
  /** Provider-side transaction id, when there is one. */
  providerRef: string | null;
}

/**
 * Boundary to whatever moves the money. The POS and API never talk to a payment processor
 * directly; adding a gateway or an integrated card terminal means adding an implementation and an
 * entry of the provider catalog (ADR 0024).
 * No implementation may receive or store raw card data.
 */
export interface PaymentProvider {
  /** Stable adapter name stored on each payment row. */
  readonly name: string;
  readonly method: PaymentMethodType;
  createPayment(request: ProviderPaymentRequest): Promise<ProviderResult>;
  authorizePayment(providerRef: string): Promise<ProviderResult>;
  capturePayment(providerRef: string): Promise<ProviderResult>;
  cancelPayment(providerRef: string): Promise<ProviderResult>;
  refundPayment(request: ProviderRefundRequest): Promise<ProviderResult>;
  getPaymentStatus(providerRef: string): Promise<ProviderResult>;
}
