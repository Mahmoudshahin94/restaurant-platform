import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Wraps and unwraps the data keys of sealed payment secrets (ADR 0024) with a master key that
 * never leaves the provider. The environment keyring below is the first implementation; a cloud
 * KMS (which wraps and unwraps without ever handing out the master key) is the next, behind the
 * same interface. Each master key has a version, stored with every sealed secret, so a key can be
 * rotated: new secrets use the newest version, and older versions stay readable until every
 * secret was re-encrypted.
 */
export interface KeyProvider {
  /** The version new data keys are wrapped with. */
  readonly currentVersion: number;
  /** The versions this provider can still unwrap. */
  readonly versions: readonly number[];
  wrapKey(dataKey: Buffer, aad: Buffer): Promise<{ version: number; wrapped: Buffer }>;
  /** Throws when the version is unknown or the wrapped key, or its additional data, was altered. */
  unwrapKey(version: number, wrapped: Buffer, aad: Buffer): Promise<Buffer>;
}

export const PAYMENT_KEY_PROVIDER = Symbol('PAYMENT_KEY_PROVIDER');

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM: iv ‖ tag ‖ ciphertext, authenticated with `aad`. */
export function gcmEncrypt(key: Buffer, plain: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Throws unless the bytes were sealed with this key and exactly this additional data. */
export function gcmDecrypt(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new Error('Sealed data is too short');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV_BYTES));
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/**
 * Parses `PAYMENT_SECRETS_KEY`: comma-separated `<version>:<base64 key>` entries (a bare base64
 * key is version 1), each key exactly 32 random bytes (`openssl rand -base64 32`). The highest
 * version is the current one. Throws on anything else, so a typo stops the server at start-up.
 */
export function parseKeyring(value: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const entry of value.split(',').map((e) => e.trim())) {
    if (entry.length === 0) continue;
    const match = /^(?:(\d{1,6}):)?([A-Za-z0-9+/=]+)$/.exec(entry);
    if (!match?.[2]) throw new Error('PAYMENT_SECRETS_KEY entries must be <version>:<base64 key>');
    const version = match[1] === undefined ? 1 : Number(match[1]);
    const key = Buffer.from(match[2], 'base64');
    if (version < 1) throw new Error('PAYMENT_SECRETS_KEY versions start at 1');
    if (key.length !== 32) throw new Error('Each PAYMENT_SECRETS_KEY key must be 32 bytes');
    if (keys.has(version)) throw new Error(`PAYMENT_SECRETS_KEY repeats version ${version}`);
    keys.set(version, key);
  }
  if (keys.size === 0) throw new Error('PAYMENT_SECRETS_KEY holds no key');
  return keys;
}

/**
 * Development and test only: a version-1 key derived from the access-token key, so a fresh
 * checkout can store test secrets without configuring anything. Production refuses to start
 * without `PAYMENT_SECRETS_KEY` (see `createKeyProvider`).
 */
export function developmentKey(jwtAccessSecret: string): Map<number, Buffer> {
  const key = Buffer.from(
    hkdfSync('sha256', jwtAccessSecret, 'madar', 'madar.payment-secrets.dev-key', 32),
  );
  return new Map([[1, key]]);
}

/** The master keys from the environment, held in this process's memory. */
export class EnvKeyProvider implements KeyProvider {
  readonly currentVersion: number;
  readonly versions: readonly number[];

  constructor(private readonly keys: ReadonlyMap<number, Buffer>) {
    this.versions = [...keys.keys()].sort((a, b) => a - b);
    const newest = this.versions.at(-1);
    if (newest === undefined) throw new Error('A key provider needs at least one key');
    this.currentVersion = newest;
  }

  private master(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) throw new Error(`Payment secrets key version ${version} is not configured`);
    return key;
  }

  wrapKey(dataKey: Buffer, aad: Buffer): Promise<{ version: number; wrapped: Buffer }> {
    const version = this.currentVersion;
    return Promise.resolve({ version, wrapped: gcmEncrypt(this.master(version), dataKey, aad) });
  }

  unwrapKey(version: number, wrapped: Buffer, aad: Buffer): Promise<Buffer> {
    return Promise.resolve(gcmDecrypt(this.master(version), wrapped, aad));
  }
}

/**
 * The cloud's key provider. Production refuses to start without `PAYMENT_SECRETS_KEY`; elsewhere
 * a development key is derived when it is unset.
 */
export function createKeyProvider(config: {
  NODE_ENV: string;
  JWT_ACCESS_SECRET: string;
  PAYMENT_SECRETS_KEY?: string | undefined;
}): KeyProvider {
  if (config.PAYMENT_SECRETS_KEY)
    return new EnvKeyProvider(parseKeyring(config.PAYMENT_SECRETS_KEY));
  if (config.NODE_ENV === 'production') {
    throw new Error(
      'PAYMENT_SECRETS_KEY is required in production: payment provider secrets cannot be stored',
    );
  }
  return new EnvKeyProvider(developmentKey(config.JWT_ACCESS_SECRET));
}

/** The location hub holds no master key and never opens a secret (they stay in the cloud). */
export const NO_KEYS: KeyProvider = {
  currentVersion: 0,
  versions: [],
  wrapKey: () => Promise.reject(new Error('Payment secrets are sealed in the cloud only')),
  unwrapKey: () => Promise.reject(new Error('Payment secrets are opened in the cloud only')),
};
