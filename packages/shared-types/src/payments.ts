/**
 * Payment configuration (ADR 0024): which provider takes each kind of payment, per tenant and
 * per location. Accounts store these values as text, so the lists below are the whole
 * vocabulary.
 */
import type { PaymentMethodType } from './enums';

type ValueOf<T> = T[keyof T];

/**
 * What a provider account takes. `CASH` and `CARD` are the till's tenders (card approved on a
 * standalone terminal), `ONLINE` the website's card checkout, and `TERMINAL` the integrated card
 * reader of a self-service kiosk (ADR 0022).
 */
export const PaymentProviderMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  ONLINE: 'ONLINE',
  TERMINAL: 'TERMINAL',
} as const;
export type PaymentProviderMethod = ValueOf<typeof PaymentProviderMethod>;
export const PAYMENT_PROVIDER_METHODS = Object.values(
  PaymentProviderMethod,
) as readonly PaymentProviderMethod[];

/** The tender type a provider method's payments are recorded under. */
export const TENDER_TYPE_OF: Record<PaymentProviderMethod, PaymentMethodType> = {
  CASH: 'CASH',
  CARD: 'CARD',
  ONLINE: 'ONLINE',
  TERMINAL: 'CARD',
};

/** `TEST` moves no real money (the provider's sandbox); `LIVE` does. */
export const PaymentProviderMode = {
  TEST: 'TEST',
  LIVE: 'LIVE',
} as const;
export type PaymentProviderMode = ValueOf<typeof PaymentProviderMode>;
export const PAYMENT_PROVIDER_MODES = Object.values(
  PaymentProviderMode,
) as readonly PaymentProviderMode[];

/** A `DISABLED` account takes no new payments; its own charges can still be voided and refunded. */
export const PaymentProviderStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type PaymentProviderStatus = ValueOf<typeof PaymentProviderStatus>;
export const PAYMENT_PROVIDER_STATUSES = Object.values(
  PaymentProviderStatus,
) as readonly PaymentProviderStatus[];

/**
 * The provider catalog's keys (also the `provider` name stored on each payment). `cash` and
 * `external-card` are built in; the mocks are development and test adapters, refused in
 * production.
 */
export const PaymentProviderKey = {
  CASH: 'cash',
  EXTERNAL_CARD: 'external-card',
  MOCK_ONLINE: 'mock-online',
  MOCK_TERMINAL: 'mock-terminal',
} as const;
export type PaymentProviderKey = ValueOf<typeof PaymentProviderKey>;
export const PAYMENT_PROVIDER_KEYS = Object.values(
  PaymentProviderKey,
) as readonly PaymentProviderKey[];
