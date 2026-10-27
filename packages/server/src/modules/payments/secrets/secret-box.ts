import { createHash, randomBytes } from 'node:crypto';
import { type KeyProvider, gcmDecrypt, gcmEncrypt } from './key-provider';

/** Provider secrets as typed by an administrator: field name → value. */
export type ProviderSecrets = Record<string, string>;

/** What is stored for one account (`payment_provider_secrets`). */
export interface SealedSecret {
  keyVersion: number;
  /** The data key, wrapped by the key provider: iv ‖ tag ‖ key. */
  wrappedKey: Uint8Array;
  /** The secrets' JSON, encrypted with the data key: iv ‖ tag ‖ ciphertext. */
  ciphertext: Uint8Array;
  fingerprint: string;
}

/** Whose secret it is: bound into both encryptions, so it cannot be moved to another account. */
export interface SecretScope {
  tenantId: string;
  accountId: string;
}

/** A sealed secret that does not open: altered, moved to another account, or its key is gone. */
export class SecretBoxError extends Error {
  constructor(readonly reason: 'UNREADABLE' | 'MALFORMED') {
    super(`Payment secret ${reason.toLowerCase()}`);
    this.name = 'SecretBoxError';
  }
}

/** Sorted keys, so the same secrets always have the same fingerprint. */
function canonical(secrets: ProviderSecrets): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(secrets).sort(([a], [b]) => (a < b ? -1 : 1))),
  );
}

const aadOf = ({ tenantId, accountId }: SecretScope, part: 'key' | 'data'): Buffer =>
  Buffer.from(`madar.payment-secret.v1|${part}|${tenantId}|${accountId}`, 'utf8');

/**
 * Envelope encryption of payment provider secrets (ADR 0024). Each seal draws a fresh 256-bit
 * data key, encrypts the secrets with it (AES-256-GCM), and has the key provider wrap the data key
 * with the current master key. The tenant and account ids are the additional authenticated data
 * of both layers: a ciphertext copied to another account, or another tenant, fails to open.
 * Plaintext secrets live only in memory, for the call that needs them.
 */
export class SecretBox {
  constructor(private readonly keys: KeyProvider) {}

  /** First 12 hex digits of the SHA-256 of the canonical JSON: which secret set is stored. */
  static fingerprint(secrets: ProviderSecrets): string {
    return createHash('sha256').update(canonical(secrets)).digest('hex').slice(0, 12);
  }

  get currentVersion(): number {
    return this.keys.currentVersion;
  }

  async seal(secrets: ProviderSecrets, scope: SecretScope): Promise<SealedSecret> {
    const dataKey = randomBytes(32);
    try {
      const ciphertext = gcmEncrypt(
        dataKey,
        Buffer.from(canonical(secrets), 'utf8'),
        aadOf(scope, 'data'),
      );
      const { version, wrapped } = await this.keys.wrapKey(dataKey, aadOf(scope, 'key'));
      return {
        keyVersion: version,
        wrappedKey: wrapped,
        ciphertext,
        fingerprint: SecretBox.fingerprint(secrets),
      };
    } finally {
      dataKey.fill(0);
    }
  }

  async open(sealed: SealedSecret, scope: SecretScope): Promise<ProviderSecrets> {
    let dataKey: Buffer;
    try {
      dataKey = await this.keys.unwrapKey(
        sealed.keyVersion,
        Buffer.from(sealed.wrappedKey),
        aadOf(scope, 'key'),
      );
    } catch {
      throw new SecretBoxError('UNREADABLE');
    }
    let plain: Buffer;
    try {
      plain = gcmDecrypt(dataKey, Buffer.from(sealed.ciphertext), aadOf(scope, 'data'));
    } catch {
      throw new SecretBoxError('UNREADABLE');
    } finally {
      dataKey.fill(0);
    }
    const parsed: unknown = JSON.parse(plain.toString('utf8'));
    plain.fill(0);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      !Object.values(parsed).every((v) => typeof v === 'string')
    ) {
      throw new SecretBoxError('MALFORMED');
    }
    return parsed as ProviderSecrets;
  }

  /**
   * Re-encrypts a secret under the current master key (a fresh data key, same fingerprint), or
   * null when it already uses it. Opening it first proves it belongs to this account.
   */
  async rotate(sealed: SealedSecret, scope: SecretScope): Promise<SealedSecret | null> {
    if (sealed.keyVersion === this.keys.currentVersion) return null;
    return this.seal(await this.open(sealed, scope), scope);
  }
}
