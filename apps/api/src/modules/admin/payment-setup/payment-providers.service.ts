import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import {
  APP_CONFIG,
  type AppConfig,
  AuditService,
  PaymentProviderFactory,
  PaymentSecretsService,
  PrismaService,
  type PrismaTx,
  isUniqueViolation,
} from '@pos/server';
import {
  PAYMENT_PROVIDER_METHODS,
  type PaymentProviderMethod,
  type PaymentProviderMode,
  TENDER_TYPE_OF,
} from '@pos/shared-types';
import {
  type EffectiveProvider,
  type PaymentProviderAccount,
  type PaymentProviderDefinition,
  type PaymentProvidersOverview,
  PAYMENT_PROVIDER_DEFINITIONS,
  type ProviderCatalogEntry,
  type ProviderSecretStatus,
  type createPaymentProviderAccountSchema,
  providerDefinition,
  type updatePaymentProviderAccountSchema,
} from '@pos/validation';
import type { z } from 'zod';

type CreateInput = z.output<typeof createPaymentProviderAccountSchema>;
type UpdateInput = z.output<typeof updatePaymentProviderAccountSchema>;

interface AccountRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  method: string;
  providerKey: string;
  mode: string;
  status: string;
  publicConfig: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const toAccount = (row: AccountRow, secret: ProviderSecretStatus): PaymentProviderAccount => ({
  id: row.id,
  locationId: row.locationId,
  method: row.method as PaymentProviderMethod,
  providerKey: row.providerKey,
  mode: row.mode as PaymentProviderMode,
  status: row.status as PaymentProviderAccount['status'],
  publicConfig: (row.publicConfig ?? {}) as Record<string, unknown>,
  secret,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** The tender created for an account whose method the business had no tender for. */
const TENDER_NAMES: Record<PaymentProviderMethod, { nameEn: string; nameAr: string }> = {
  CASH: { nameEn: 'Cash', nameAr: 'نقدًا' },
  CARD: { nameEn: 'Card', nameAr: 'بطاقة' },
  ONLINE: { nameEn: 'Online card', nameAr: 'بطاقة عبر الإنترنت' },
  TERMINAL: { nameEn: 'Kiosk card', nameAr: 'بطاقة في الكشك' },
};

/** Where a schema refused a value: paths and codes only, never the value (it may be a secret). */
const issuesOf = (error: z.ZodError) =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));

const invalid = (reason: string, details: Record<string, unknown> = {}) =>
  new DomainError('PAYMENT_PROVIDER_INVALID', 'The payment provider cannot be set up this way', {
    reason,
    ...details,
  });

/**
 * Payment provider accounts (ADR 0024), the admin's payment providers page: which provider takes
 * each method for the whole business or one location, its mode, public configuration and secrets.
 * Secrets are write-only: they are validated, sealed and stored, and every answer shows only
 * whether one is stored, its fingerprint and when it last changed. Accounts are never deleted
 * (payments name them): they are disabled. Cloud only; hubs receive the accounts (without
 * secrets) with the snapshot.
 */
@Injectable()
export class PaymentProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly secrets: PaymentSecretsService,
    private readonly factory: PaymentProviderFactory,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The providers this installation offers (test adapters only outside production). */
  catalog(): ProviderCatalogEntry[] {
    return Object.values(PAYMENT_PROVIDER_DEFINITIONS)
      .filter((d) => this.offered(d))
      .map((d) => ({
        key: d.key,
        method: d.method,
        modes: [...d.modes],
        builtIn: d.builtIn,
        devOnly: d.devOnly,
        publicFields: d.publicFields.map((f) => ({ ...f })),
        secretFields: d.secretFields.map((f) => ({ ...f })),
      }));
  }

  async overview(tenantId: string): Promise<PaymentProvidersOverview> {
    const rows = await this.prisma.paymentProviderAccount.findMany({
      where: { tenantId },
      orderBy: [{ method: 'asc' }, { createdAt: 'asc' }],
    });
    const status = await this.secrets.status(rows.map((r) => r.id));
    const locations = await this.prisma.location.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    const effective: EffectiveProvider[] = [];
    for (const { id: locationId } of locations) {
      const resolved = await this.factory.resolveAll(tenantId, locationId);
      for (const method of PAYMENT_PROVIDER_METHODS) {
        const { value, source } = resolved[method];
        effective.push({
          locationId,
          method,
          providerKey: value?.providerKey ?? null,
          mode: value?.mode ?? null,
          accountId: value?.accountId ?? null,
          source: source === 'LOCATION' || source === 'TENANT' ? source : 'PLATFORM',
        });
      }
    }
    return {
      catalog: this.catalog(),
      accounts: rows.map((r) => toAccount(r, this.secretStatus(status, r.id))),
      effective,
    };
  }

  async create(tenantId: string, input: CreateInput): Promise<PaymentProviderAccount> {
    const definition = this.definitionFor(input.providerKey, input.method);
    this.assertMode(definition, input.mode);
    const publicConfig = this.publicConfig(definition, input.publicConfig);
    const secrets = this.secretValues(definition, input.secrets);
    if (input.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: input.locationId, tenantId },
        select: { id: true },
      });
      if (!location) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (input.status === 'ACTIVE') {
          await this.assertNoActive(tx, tenantId, input.method, input.locationId, null);
        }
        const row = await tx.paymentProviderAccount.create({
          data: {
            tenantId,
            locationId: input.locationId,
            method: input.method,
            providerKey: definition.key,
            mode: input.mode,
            status: input.status,
            publicConfig,
          },
        });
        const fingerprint = secrets ? await this.secrets.write(tx, row, secrets) : null;
        const tender = await this.ensureTender(tx, tenantId, row.id, input.method);
        await this.audit.record(
          {
            action: 'payment_provider.created',
            entityType: 'PaymentProviderAccount',
            entityId: row.id,
            locationId: input.locationId,
            metadata: {
              method: input.method,
              providerKey: definition.key,
              mode: input.mode,
              status: input.status,
              publicConfig,
              fingerprint,
              tenderCreated: tender,
            },
          },
          tx,
        );
        return this.dto(tx, row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.activeExists(input.method);
      throw error;
    }
  }

  async update(
    tenantId: string,
    accountId: string,
    input: UpdateInput,
  ): Promise<PaymentProviderAccount> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.paymentProviderAccount.findFirst({
          where: { id: accountId, tenantId },
        });
        if (!before) {
          throw new DomainError('PAYMENT_PROVIDER_NOT_FOUND', 'Payment provider not found');
        }
        const definition = this.definitionFor(before.providerKey, before.method);
        const mode = (input.mode ?? before.mode) as PaymentProviderMode;
        this.assertMode(definition, mode);
        const publicConfig =
          input.publicConfig === undefined
            ? undefined
            : this.publicConfig(definition, input.publicConfig);
        const secrets = this.secretValues(definition, input.secrets);
        if (input.status === 'ACTIVE' && before.status !== 'ACTIVE') {
          await this.assertNoActive(
            tx,
            tenantId,
            before.method as PaymentProviderMethod,
            before.locationId,
            before.id,
          );
        }
        const [previous] = (await this.secrets.status([before.id])).values();
        const row = await tx.paymentProviderAccount.update({
          where: { id: accountId },
          data: {
            ...(input.mode ? { mode } : {}),
            ...(publicConfig ? { publicConfig } : {}),
            ...(input.status ? { status: input.status } : {}),
            // A new secret alone is a change of the account too: its hubs and caches move on.
            ...(secrets ? { updatedAt: new Date() } : {}),
          },
        });
        const fingerprint = secrets ? await this.secrets.write(tx, row, secrets) : null;
        await this.audit.record(
          {
            action: 'payment_provider.updated',
            entityType: 'PaymentProviderAccount',
            entityId: row.id,
            locationId: row.locationId,
            metadata: {
              providerKey: row.providerKey,
              changes: {
                ...(input.mode ? { mode } : {}),
                ...(publicConfig ? { publicConfig } : {}),
                ...(input.status ? { status: input.status } : {}),
              },
              before: {
                mode: before.mode,
                status: before.status,
                publicConfig: before.publicConfig,
              },
              ...(fingerprint
                ? { fingerprint, previousFingerprint: previous?.fingerprint ?? null }
                : {}),
            },
          },
          tx,
        );
        return this.dto(tx, row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.activeExists(null);
      throw error;
    }
  }

  // --- helpers -----------------------------------------------------------------------------------

  private offered(definition: PaymentProviderDefinition): boolean {
    return !(definition.devOnly && this.config.NODE_ENV === 'production');
  }

  private definitionFor(providerKey: string, method: string): PaymentProviderDefinition {
    const definition = providerDefinition(providerKey);
    if (!definition || !this.offered(definition)) {
      throw invalid('UNKNOWN_PROVIDER', { providerKey });
    }
    if (definition.builtIn) throw invalid('BUILT_IN', { providerKey });
    if (definition.method !== method) {
      throw invalid('WRONG_METHOD', { providerKey, method: definition.method });
    }
    return definition;
  }

  private assertMode(definition: PaymentProviderDefinition, mode: PaymentProviderMode): void {
    if (!definition.modes.includes(mode)) {
      throw invalid('MODE_NOT_SUPPORTED', { mode, modes: definition.modes });
    }
  }

  private publicConfig(definition: PaymentProviderDefinition, value: Record<string, unknown>) {
    const parsed = definition.publicConfig.safeParse(value);
    if (!parsed.success) throw invalid('INVALID_CONFIG', { issues: issuesOf(parsed.error) });
    return parsed.data as Record<string, string | number | boolean>;
  }

  /** The validated secrets to store, or null to keep what is stored (nothing was typed). */
  private secretValues(
    definition: PaymentProviderDefinition,
    value: Record<string, string> | undefined,
  ): Record<string, string> | null {
    const typed = Object.fromEntries(
      Object.entries(value ?? {}).filter(([, v]) => v.trim().length > 0),
    );
    if (Object.keys(typed).length === 0) return null;
    if (!definition.secrets) throw invalid('NO_SECRETS');
    const parsed = definition.secrets.safeParse(typed);
    if (!parsed.success) throw invalid('INVALID_SECRETS', { issues: issuesOf(parsed.error) });
    return parsed.data as Record<string, string>;
  }

  private async assertNoActive(
    tx: PrismaTx,
    tenantId: string,
    method: PaymentProviderMethod,
    locationId: string | null,
    except: string | null,
  ): Promise<void> {
    const active = await tx.paymentProviderAccount.count({
      where: {
        tenantId,
        method,
        locationId,
        status: 'ACTIVE',
        ...(except ? { id: { not: except } } : {}),
      },
    });
    if (active > 0) throw this.activeExists(method);
  }

  private activeExists(method: PaymentProviderMethod | null): DomainError {
    return new DomainError('CONFLICT', 'Disable the active provider of this method first', {
      reason: 'ACTIVE_ACCOUNT_EXISTS',
      ...(method ? { method } : {}),
    });
  }

  /**
   * Website and kiosk payments are recorded under a tender (ADR 0024): an account whose method
   * the business had no tender for gets one, linked to it. Returns whether one was created.
   */
  private async ensureTender(
    tx: PrismaTx,
    tenantId: string,
    accountId: string,
    method: PaymentProviderMethod,
  ): Promise<boolean> {
    const type = TENDER_TYPE_OF[method];
    const existing = await tx.paymentMethod.count({ where: { tenantId, type, archivedAt: null } });
    if (existing > 0) return false;
    const last = await tx.paymentMethod.aggregate({
      where: { tenantId },
      _max: { sortOrder: true },
    });
    await tx.paymentMethod.create({
      data: {
        tenantId,
        type,
        ...TENDER_NAMES[method],
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        providerAccountId: accountId,
      },
    });
    return true;
  }

  private secretStatus(map: Map<string, ProviderSecretStatus>, id: string): ProviderSecretStatus {
    return map.get(id) ?? { hasSecret: false, fingerprint: null, updatedAt: null };
  }

  private async dto(tx: PrismaTx, row: AccountRow): Promise<PaymentProviderAccount> {
    const stored = await tx.paymentProviderSecret.findUnique({
      where: { accountId: row.id },
      select: { fingerprint: true, updatedAt: true },
    });
    return toAccount(row, {
      hasSecret: stored !== null,
      fingerprint: stored?.fingerprint ?? null,
      updatedAt: stored?.updatedAt.toISOString() ?? null,
    });
  }
}
