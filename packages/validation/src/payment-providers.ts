import {
  type PaymentProviderKey,
  PaymentProviderMethod,
  PaymentProviderMode,
  PaymentProviderStatus,
  enumValues,
} from '@pos/shared-types';
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * Payment configuration (ADR 0024). Each provider of the catalog declares the method it takes,
 * the modes it supports, where it runs, and two strict schemas: its public configuration (stored
 * in clear, shown to administrators, sent to hubs) and its secrets (encrypted in the cloud, never
 * returned, logged or synced). The server's `PROVIDER_CATALOG` adds the adapters.
 */

/** Where an adapter can run: secrets never leave the cloud, so an adapter needing them is cloud-only. */
export type ProviderRuntime = 'cloud' | 'hub' | 'anywhere';

/** One field of a provider's form in the admin (labels come from its translations). */
export interface ProviderFieldSpec {
  name: string;
  required: boolean;
  /** Shown under the field, e.g. the expected prefix of a key. */
  hint?: string;
}

export interface PaymentProviderDefinition {
  key: PaymentProviderKey;
  method: PaymentProviderMethod;
  modes: readonly PaymentProviderMode[];
  runsOn: ProviderRuntime;
  /** Used without an account, as the platform's default for its method. Not configurable. */
  builtIn: boolean;
  /** A development and test adapter that moves no money: refused in production. */
  devOnly: boolean;
  publicConfig: z.ZodObject;
  /** Null: the provider has no secrets. */
  secrets: z.ZodObject | null;
  publicFields: readonly ProviderFieldSpec[];
  secretFields: readonly ProviderFieldSpec[];
}

const none = z.strictObject({});

export const PAYMENT_PROVIDER_DEFINITIONS: Record<PaymentProviderKey, PaymentProviderDefinition> = {
  cash: {
    key: 'cash',
    method: 'CASH',
    modes: ['LIVE'],
    runsOn: 'anywhere',
    builtIn: true,
    devOnly: false,
    publicConfig: none,
    secrets: null,
    publicFields: [],
    secretFields: [],
  },
  'external-card': {
    key: 'external-card',
    method: 'CARD',
    modes: ['LIVE'],
    runsOn: 'anywhere',
    builtIn: true,
    devOnly: false,
    publicConfig: none,
    secrets: null,
    publicFields: [],
    secretFields: [],
  },
  'mock-online': {
    key: 'mock-online',
    method: 'ONLINE',
    modes: ['TEST'],
    runsOn: 'cloud',
    builtIn: false,
    devOnly: true,
    publicConfig: z.strictObject({
      /** What the customer's statement would show (a real gateway's descriptor). */
      statementDescriptor: z
        .string()
        .trim()
        .min(1)
        .max(22)
        .regex(/^[A-Za-z0-9 .-]+$/)
        .optional(),
    }),
    secrets: z.strictObject({
      /** Stands in for a gateway's secret API key; checked by the adapter, never shown again. */
      secretKey: z
        .string()
        .trim()
        .regex(/^sk_test_[A-Za-z0-9]{8,64}$/)
        .optional(),
    }),
    publicFields: [{ name: 'statementDescriptor', required: false }],
    secretFields: [{ name: 'secretKey', required: false, hint: 'sk_test_…' }],
  },
  'mock-terminal': {
    key: 'mock-terminal',
    method: 'TERMINAL',
    modes: ['TEST'],
    runsOn: 'hub',
    builtIn: false,
    devOnly: true,
    publicConfig: z.strictObject({
      /** The reader's label on the kiosk's payment screen and in reports. */
      terminalLabel: z.string().trim().min(1).max(40).optional(),
    }),
    secrets: null,
    publicFields: [{ name: 'terminalLabel', required: false }],
    secretFields: [],
  },
};

export function providerDefinition(key: string): PaymentProviderDefinition | null {
  return Object.hasOwn(PAYMENT_PROVIDER_DEFINITIONS, key)
    ? PAYMENT_PROVIDER_DEFINITIONS[key as PaymentProviderKey]
    : null;
}

// --- DTOs ---------------------------------------------------------------------------------------

export const paymentProviderMethodSchema = z.enum(enumValues(PaymentProviderMethod));
export const paymentProviderModeSchema = z.enum(enumValues(PaymentProviderMode));
export const paymentProviderStatusSchema = z.enum(enumValues(PaymentProviderStatus));

/** What the API says about an account's secrets: never the secrets themselves. */
export const providerSecretStatusSchema = z.object({
  hasSecret: z.boolean(),
  /** First 12 hex digits of the SHA-256 of the stored secrets (canonical JSON). */
  fingerprint: z.string().nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
});
export type ProviderSecretStatus = z.infer<typeof providerSecretStatusSchema>;

export const paymentProviderAccountSchema = z.object({
  id: idSchema,
  /** Null: the whole business; otherwise this location's override. */
  locationId: idSchema.nullable(),
  method: paymentProviderMethodSchema,
  providerKey: z.string(),
  mode: paymentProviderModeSchema,
  status: paymentProviderStatusSchema,
  publicConfig: z.record(z.string(), z.unknown()),
  secret: providerSecretStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PaymentProviderAccount = z.infer<typeof paymentProviderAccountSchema>;

/** Secret values typed by an administrator; validated against the provider's schema. */
const secretInputSchema = z.record(z.string().max(64), z.string().max(500));

export const createPaymentProviderAccountSchema = z.object({
  locationId: idSchema.nullable().default(null),
  method: paymentProviderMethodSchema,
  providerKey: z.string().min(1).max(64),
  mode: paymentProviderModeSchema,
  publicConfig: z.record(z.string().max(64), z.unknown()).default({}),
  secrets: secretInputSchema.optional(),
  status: paymentProviderStatusSchema.default('ACTIVE'),
});
export type CreatePaymentProviderAccountRequest = z.input<
  typeof createPaymentProviderAccountSchema
>;

/**
 * Changes to an account. Its method, provider and scope are fixed (its payments name it): to
 * switch providers, disable it and add another. `secrets` replaces the stored set; absent keeps it.
 */
export const updatePaymentProviderAccountSchema = z
  .object({
    mode: paymentProviderModeSchema.optional(),
    publicConfig: z.record(z.string().max(64), z.unknown()).optional(),
    secrets: secretInputSchema.optional(),
    status: paymentProviderStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Nothing to change',
  });
export type UpdatePaymentProviderAccountRequest = z.input<
  typeof updatePaymentProviderAccountSchema
>;

export const providerFieldSpecSchema = z.object({
  name: z.string(),
  required: z.boolean(),
  hint: z.string().optional(),
});

/** A provider the administrator may pick (the production catalog has no test adapters). */
export const providerCatalogEntrySchema = z.object({
  key: z.string(),
  method: paymentProviderMethodSchema,
  modes: z.array(paymentProviderModeSchema),
  builtIn: z.boolean(),
  devOnly: z.boolean(),
  publicFields: z.array(providerFieldSpecSchema),
  secretFields: z.array(providerFieldSpecSchema),
});
export type ProviderCatalogEntry = z.infer<typeof providerCatalogEntrySchema>;

/** Which provider takes a method at a location, and the layer that decided it. */
export const effectiveProviderSchema = z.object({
  locationId: idSchema,
  method: paymentProviderMethodSchema,
  /** Null: nothing takes this method here (online checkout and kiosk cards are refused). */
  providerKey: z.string().nullable(),
  mode: paymentProviderModeSchema.nullable(),
  accountId: idSchema.nullable(),
  source: z.enum(['PLATFORM', 'TENANT', 'LOCATION']),
});
export type EffectiveProvider = z.infer<typeof effectiveProviderSchema>;

export const paymentProvidersOverviewSchema = z.object({
  catalog: z.array(providerCatalogEntrySchema),
  accounts: z.array(paymentProviderAccountSchema),
  effective: z.array(effectiveProviderSchema),
});
export type PaymentProvidersOverview = z.infer<typeof paymentProvidersOverviewSchema>;
