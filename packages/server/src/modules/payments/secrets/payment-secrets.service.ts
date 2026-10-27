import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProviderSecretStatus } from '@pos/validation';
import { SERVER_MODE, type ServerMode } from '../../../common/auth/managed-in-cloud';
import { TenantContext } from '../../../common/tenancy/tenant-context';
import { PrismaService, type PrismaTx } from '../../../prisma/prisma.service';
import { PAYMENT_KEY_PROVIDER, type KeyProvider } from './key-provider';
import { type ProviderSecrets, SecretBox } from './secret-box';

const NO_SECRET: ProviderSecretStatus = { hasSecret: false, fingerprint: null, updatedAt: null };

/**
 * The cloud's store of payment provider secrets (ADR 0024), sealed by `SecretBox`. Secrets are
 * write-only to everyone outside this class: callers get a status (`hasSecret`, fingerprint, last
 * change), and only the payment provider factory opens them, for the call that charges or voids.
 * The location hub has no such table and never holds a secret: `read` answers null there.
 */
@Injectable()
export class PaymentSecretsService {
  private readonly logger = new Logger(PaymentSecretsService.name);
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_KEY_PROVIDER) keys: KeyProvider,
    @Inject(SERVER_MODE) private readonly mode: ServerMode,
  ) {
    this.box = new SecretBox(keys);
  }

  /** What may be shown of each account's secrets. */
  async status(accountIds: readonly string[]): Promise<Map<string, ProviderSecretStatus>> {
    const result = new Map(accountIds.map((id) => [id, NO_SECRET]));
    if (this.mode !== 'cloud' || accountIds.length === 0) return result;
    const rows = await this.prisma.paymentProviderSecret.findMany({
      where: { accountId: { in: [...accountIds] } },
      select: { accountId: true, fingerprint: true, updatedAt: true },
    });
    for (const row of rows) {
      result.set(row.accountId, {
        hasSecret: true,
        fingerprint: row.fingerprint,
        updatedAt: row.updatedAt.toISOString(),
      });
    }
    return result;
  }

  /** Seals and stores an account's secrets (replacing any), inside the caller's transaction. */
  async write(
    tx: PrismaTx,
    account: { id: string; tenantId: string },
    secrets: ProviderSecrets,
  ): Promise<string> {
    const sealed = await this.box.seal(secrets, {
      tenantId: account.tenantId,
      accountId: account.id,
    });
    const data = {
      keyVersion: sealed.keyVersion,
      wrappedKey: Buffer.from(sealed.wrappedKey),
      ciphertext: Buffer.from(sealed.ciphertext),
      fingerprint: sealed.fingerprint,
    };
    await tx.paymentProviderSecret.upsert({
      where: { accountId: account.id },
      create: { accountId: account.id, tenantId: account.tenantId, ...data },
      update: data,
    });
    return sealed.fingerprint;
  }

  /**
   * An account's secrets, opened for one provider call; null when it has none (or on the hub).
   * Throws `SecretBoxError` when the stored secret does not open for this account.
   */
  async read(account: { id: string; tenantId: string }): Promise<ProviderSecrets | null> {
    if (this.mode !== 'cloud') return null;
    const row = await this.prisma.paymentProviderSecret.findUnique({
      where: { accountId: account.id },
    });
    if (!row) return null;
    return this.box.open(row, { tenantId: account.tenantId, accountId: account.id });
  }

  /**
   * Key rotation: re-encrypts every secret sealed with an older master key under the current
   * one, tenant by tenant. Afterwards the old key versions can be removed from
   * `PAYMENT_SECRETS_KEY`. A secret that does not open is reported and left as it is.
   */
  async rotateAll(): Promise<{ rotated: number; failed: number; currentVersion: number }> {
    const currentVersion = this.box.currentVersion;
    const stale = await TenantContext.runUnscoped('payment secret key rotation', () =>
      this.prisma.paymentProviderSecret.findMany({
        where: { keyVersion: { not: currentVersion } },
        select: { accountId: true, tenantId: true },
      }),
    );
    let rotated = 0;
    let failed = 0;
    for (const { accountId, tenantId } of stale) {
      try {
        await TenantContext.runInTenant(tenantId, () =>
          this.prisma.$transaction(async (tx) => {
            const row = await tx.paymentProviderSecret.findUnique({ where: { accountId } });
            if (!row) return;
            const sealed = await this.box.rotate(row, { tenantId, accountId });
            if (!sealed) return;
            await tx.paymentProviderSecret.update({
              where: { accountId },
              data: {
                keyVersion: sealed.keyVersion,
                wrappedKey: Buffer.from(sealed.wrappedKey),
                ciphertext: Buffer.from(sealed.ciphertext),
                // The secret itself did not change: its last change stays what administrators see.
                updatedAt: row.updatedAt,
              },
            });
            rotated += 1;
          }),
        );
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Payment secret of account ${accountId} was not rotated: ${(error as Error).name}`,
        );
      }
    }
    return { rotated, failed, currentVersion };
  }
}
