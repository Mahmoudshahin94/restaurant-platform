import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  type PlatformProviders,
  type ProviderChoice,
  resolvePaymentProviders,
} from '@pos/domain';
import type {
  ConfigLayer,
  PaymentMethodType,
  PaymentProviderMethod,
  PaymentProviderMode,
  PaymentProviderStatus,
} from '@pos/shared-types';
import { APP_CONFIG, type AppConfig } from '../../../config/env';
import { SERVER_MODE, type ServerMode } from '../../../common/auth/managed-in-cloud';
import { PrismaService, type PrismaTx } from '../../../prisma/prisma.service';
import { PaymentSecretsService } from '../secrets/payment-secrets.service';
import { SecretBoxError } from '../secrets/secret-box';
import { type CatalogEntry, catalogEntry } from './catalog';
import type { PaymentProvider } from './payment-provider';

/** A provider account row as stored (cloud or hub). */
export interface ProviderAccountRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  method: string;
  providerKey: string;
  mode: string;
  status: string;
  publicConfig: unknown;
}

/** The adapter that takes a method, configured from the account that chose it. */
export interface ConfiguredProvider {
  provider: PaymentProvider;
  /** Recorded on each payment it takes, so its voids and refunds go back the same way. */
  accountId: string | null;
  providerKey: string;
  mode: PaymentProviderMode;
  source: ConfigLayer;
}

type Db = PrismaService | PrismaTx;

const asAccountRef = (row: ProviderAccountRow) => ({
  id: row.id,
  locationId: row.locationId,
  method: row.method as PaymentProviderMethod,
  providerKey: row.providerKey,
  mode: row.mode as PaymentProviderMode,
  status: row.status as PaymentProviderStatus,
});

/**
 * Picks and configures the payment provider of a tenant (ADR 0024). The provider of a method is
 * resolved in layers (`resolvePaymentProviders`): the platform's default (the built-in cash and
 * external-card providers, plus `DEV_PAYMENT_PROVIDERS` outside production), then the tenant's
 * ACTIVE account, then the location's. The adapter is built from the provider catalog with the
 * account's mode, public configuration and secrets, which are opened in the cloud only, for this
 * call. A tenant with no ONLINE account (cash only) is refused online checkout; a recorded payment
 * is voided or refunded through the account that took it (`forPayment`), even a disabled one.
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);
  private readonly platform: PlatformProviders;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: PaymentSecretsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SERVER_MODE) private readonly mode: ServerMode,
  ) {
    const dev = (key: string): ProviderChoice | null =>
      config.NODE_ENV !== 'production' && (config.DEV_PAYMENT_PROVIDERS as string[]).includes(key)
        ? { accountId: null, providerKey: key, mode: 'TEST' }
        : null;
    this.platform = {
      CASH: { accountId: null, providerKey: 'cash', mode: 'LIVE' },
      CARD: { accountId: null, providerKey: 'external-card', mode: 'LIVE' },
      ONLINE: dev('mock-online'),
      TERMINAL: dev('mock-terminal'),
    };
  }

  /** The provider of every method for a tenant, at a location (or tenant-wide without one). */
  async resolveAll(tenantId: string, locationId: string | null, db: Db = this.prisma) {
    const rows = await db.paymentProviderAccount.findMany({ where: { tenantId } });
    return resolvePaymentProviders(rows.map(asAccountRef), locationId, this.platform);
  }

  /** Whether something takes the method there (and can run on this server). */
  async available(
    tenantId: string,
    method: PaymentProviderMethod,
    locationId: string | null,
    db: Db = this.prisma,
  ): Promise<boolean> {
    const { value } = (await this.resolveAll(tenantId, locationId, db))[method];
    const entry = value ? catalogEntry(value.providerKey) : null;
    return entry !== null && this.runsHere(entry);
  }

  /**
   * The configured adapter that takes `method` for this tenant at this location. Refuses clearly
   * when nothing does: `ONLINE_PAYMENT_UNAVAILABLE` for online checkout, `PAYMENT_FAILED`
   * (`PROVIDER_NOT_CONFIGURED`) otherwise.
   */
  async forTenant(
    tenantId: string,
    method: PaymentProviderMethod,
    locationId: string | null,
    db: Db = this.prisma,
  ): Promise<ConfiguredProvider> {
    const { value, source } = (await this.resolveAll(tenantId, locationId, db))[method];
    if (!value) throw this.notConfigured(method);
    const row = value.accountId
      ? await db.paymentProviderAccount.findFirst({ where: { id: value.accountId, tenantId } })
      : null;
    const provider = await this.build(value.providerKey, method, value.mode, row);
    return {
      provider,
      accountId: value.accountId,
      providerKey: value.providerKey,
      mode: value.mode,
      source,
    };
  }

  /**
   * The adapter that took a recorded payment, to void or refund it: the account it names (even
   * disabled since), else the platform's provider of that name. Never another account.
   */
  async forPayment(
    payment: {
      tenantId: string;
      provider: string;
      providerAccountId: string | null;
      methodType: PaymentMethodType;
    },
    db: Db = this.prisma,
  ): Promise<PaymentProvider> {
    if (payment.providerAccountId) {
      const row = await db.paymentProviderAccount.findFirst({
        where: { id: payment.providerAccountId, tenantId: payment.tenantId },
      });
      if (!row) throw this.notConfigured(null);
      return this.build(
        row.providerKey,
        row.method as PaymentProviderMethod,
        row.mode as PaymentProviderMode,
        row,
      );
    }
    const entry = catalogEntry(payment.provider);
    if (!entry) throw this.notConfigured(null);
    const { key, method, modes } = entry.definition;
    return this.build(key, method, modes[0] ?? 'TEST', null);
  }

  private allowed(entry: CatalogEntry): boolean {
    return !(entry.definition.devOnly && this.config.NODE_ENV === 'production');
  }

  private runsHere(entry: CatalogEntry): boolean {
    const runsOn = entry.definition.runsOn;
    return this.allowed(entry) && (runsOn === 'anywhere' || runsOn === this.mode);
  }

  private notConfigured(method: PaymentProviderMethod | null): DomainError {
    return method === 'ONLINE'
      ? new DomainError('ONLINE_PAYMENT_UNAVAILABLE', 'The business takes no online card payments')
      : new DomainError('PAYMENT_FAILED', 'No payment provider is set up for this method', {
          reason: 'PROVIDER_NOT_CONFIGURED',
          ...(method ? { method } : {}),
        });
  }

  private async build(
    providerKey: string,
    method: PaymentProviderMethod,
    mode: PaymentProviderMode,
    row: ProviderAccountRow | null,
  ): Promise<PaymentProvider> {
    const entry = catalogEntry(providerKey);
    if (!entry || entry.definition.method !== method || !this.runsHere(entry)) {
      throw this.notConfigured(method);
    }
    const publicConfig = entry.definition.publicConfig.safeParse(row?.publicConfig ?? {});
    if (!publicConfig.success) throw this.notConfigured(method);
    let secrets: Record<string, string> = {};
    if (row && entry.definition.secrets) {
      try {
        const opened = (await this.secrets.read(row)) ?? {};
        const parsed = entry.definition.secrets.safeParse(opened);
        if (!parsed.success) throw this.notConfigured(method);
        secrets = parsed.data as Record<string, string>;
      } catch (error) {
        if (!(error instanceof SecretBoxError)) throw error;
        // Only the account is named: never the stored bytes or what they hold.
        this.logger.error(`The secret of payment provider account ${row.id} does not open`);
        throw new DomainError('PAYMENT_FAILED', 'The payment provider cannot be used', {
          reason: 'PROVIDER_SECRET_UNREADABLE',
        });
      }
    }
    return entry.create({ mode, publicConfig: publicConfig.data, secrets });
  }
}
