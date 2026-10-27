import {
  PAYMENT_PROVIDER_METHODS,
  type PaymentProviderMethod,
  type PaymentProviderMode,
  type PaymentProviderStatus,
} from '@pos/shared-types';
import { type LayeredValue, resolveLayered } from '../config/resolve-layered';

/** What resolution needs of a provider account (ADR 0024). */
export interface ProviderAccountRef {
  id: string;
  /** Null: the whole tenant; otherwise one location's override. */
  locationId: string | null;
  method: PaymentProviderMethod;
  providerKey: string;
  mode: PaymentProviderMode;
  status: PaymentProviderStatus;
}

/** The provider that takes a method: an account, or the platform's default (no account). */
export interface ProviderChoice {
  accountId: string | null;
  providerKey: string;
  mode: PaymentProviderMode;
}

/** The platform layer: the built-in or development default of each method, or nothing. */
export type PlatformProviders = Record<PaymentProviderMethod, ProviderChoice | null>;

/**
 * Which provider takes each payment method at a location (or tenant-wide, without one), through
 * the configuration layers: the platform's default, then the tenant's account, then the
 * location's own. Only ACTIVE accounts say something; a disabled one inherits. A null value
 * means nothing takes the method there: online checkout and kiosk cards are refused.
 */
export function resolvePaymentProviders(
  accounts: readonly ProviderAccountRef[],
  locationId: string | null,
  platform: PlatformProviders,
): Record<PaymentProviderMethod, LayeredValue<ProviderChoice | null>> {
  const layer = (scope: string | null) =>
    Object.fromEntries(
      accounts
        .filter((a) => a.status === 'ACTIVE' && a.locationId === scope)
        .map((a) => [a.method, { accountId: a.id, providerKey: a.providerKey, mode: a.mode }]),
    ) as Partial<Record<PaymentProviderMethod, ProviderChoice>>;
  return resolveLayered<PaymentProviderMethod, ProviderChoice | null>(PAYMENT_PROVIDER_METHODS, {
    PLATFORM: platform,
    TENANT: layer(null),
    ...(locationId ? { LOCATION: layer(locationId) } : {}),
  });
}
