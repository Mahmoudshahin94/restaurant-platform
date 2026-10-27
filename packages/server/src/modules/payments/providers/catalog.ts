import type { PaymentProviderKey, PaymentProviderMode } from '@pos/shared-types';
import { PAYMENT_PROVIDER_DEFINITIONS, type PaymentProviderDefinition } from '@pos/validation';
import { CashPaymentProvider } from './cash.provider';
import { ExternalCardPaymentProvider } from './external-card.provider';
import { MockOnlinePaymentProvider } from './mock-online.provider';
import { MockPaymentTerminal } from './mock-terminal.provider';
import type { PaymentProvider } from './payment-provider';

/** What an adapter is built from: its account's mode, public configuration and opened secrets. */
export interface ProviderSettings {
  mode: PaymentProviderMode;
  /** Already validated by the provider's public configuration schema. */
  publicConfig: Record<string, unknown>;
  /** Already validated by its secrets schema; empty when it has none (or on the hub). */
  secrets: Record<string, string>;
}

export interface CatalogEntry {
  definition: PaymentProviderDefinition;
  create(settings: ProviderSettings): PaymentProvider;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Every payment provider MADAR can use (ADR 0024): the definition shared with the apps (method,
 * modes, where it runs, configuration and secret schemas) and the adapter it builds. A gateway is
 * a new entry here plus its definition; nothing else changes. Replaces the static registry and
 * the process-wide `ONLINE_PAYMENT_PROVIDER`/`PAYMENT_TERMINAL_PROVIDER` choices.
 */
export const PROVIDER_CATALOG: Record<PaymentProviderKey, CatalogEntry> = {
  cash: {
    definition: PAYMENT_PROVIDER_DEFINITIONS.cash,
    create: () => new CashPaymentProvider(),
  },
  'external-card': {
    definition: PAYMENT_PROVIDER_DEFINITIONS['external-card'],
    create: () => new ExternalCardPaymentProvider(),
  },
  'mock-online': {
    definition: PAYMENT_PROVIDER_DEFINITIONS['mock-online'],
    create: ({ publicConfig, secrets }) =>
      new MockOnlinePaymentProvider({
        statementDescriptor: text(publicConfig.statementDescriptor),
        secretKey: secrets.secretKey,
      }),
  },
  'mock-terminal': {
    definition: PAYMENT_PROVIDER_DEFINITIONS['mock-terminal'],
    create: ({ publicConfig }) => new MockPaymentTerminal(text(publicConfig.terminalLabel) ?? null),
  },
};

export function catalogEntry(key: string): CatalogEntry | null {
  return Object.hasOwn(PROVIDER_CATALOG, key) ? PROVIDER_CATALOG[key as PaymentProviderKey] : null;
}
