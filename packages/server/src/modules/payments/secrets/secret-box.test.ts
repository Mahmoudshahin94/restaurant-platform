import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvKeyProvider, createKeyProvider, developmentKey, parseKeyring } from './key-provider';
import { SecretBox, SecretBoxError } from './secret-box';

const A = {
  tenantId: '0199e4a0-0000-7000-8000-00000000000a',
  accountId: '0199e4a0-0000-7000-8000-0000000000a1',
};
const B = {
  tenantId: '0199e4a0-0000-7000-8000-00000000000b',
  accountId: '0199e4a0-0000-7000-8000-0000000000b1',
};
const secrets = { secretKey: 'sk_test_abcdefgh12345678' };
const key = () => randomBytes(32);

describe('SecretBox (ADR 0024)', () => {
  it('seals with a fresh data key and opens only for the same account', async () => {
    const box = new SecretBox(new EnvKeyProvider(new Map([[1, key()]])));
    const sealed = await box.seal(secrets, A);
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.wrappedKey.length).toBe(60);
    // Neither layer holds the secret in clear.
    expect(Buffer.from(sealed.ciphertext).toString('utf8')).not.toContain('sk_test');
    expect(Buffer.from(sealed.wrappedKey).toString('utf8')).not.toContain('sk_test');
    await expect(box.open(sealed, A)).resolves.toEqual(secrets);
    // Same secrets, new nonce and data key: a different ciphertext, the same fingerprint.
    const again = await box.seal(secrets, A);
    expect(Buffer.from(again.ciphertext).equals(Buffer.from(sealed.ciphertext))).toBe(false);
    expect(again.fingerprint).toBe(sealed.fingerprint);
  });

  it('refuses a ciphertext moved to another tenant or account', async () => {
    const box = new SecretBox(new EnvKeyProvider(new Map([[1, key()]])));
    const sealed = await box.seal(secrets, A);
    await expect(box.open(sealed, B)).rejects.toBeInstanceOf(SecretBoxError);
    await expect(box.open(sealed, { ...A, tenantId: B.tenantId })).rejects.toThrow(
      'Payment secret unreadable',
    );
    await expect(box.open(sealed, { ...A, accountId: B.accountId })).rejects.toBeInstanceOf(
      SecretBoxError,
    );
    // Data of one seal with the data key of another does not open either.
    const other = await box.seal(secrets, A);
    await expect(box.open({ ...sealed, wrappedKey: other.wrappedKey }, A)).rejects.toBeInstanceOf(
      SecretBoxError,
    );
    // A flipped bit anywhere is caught by the authentication tag.
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await expect(box.open({ ...sealed, ciphertext: tampered }, A)).rejects.toBeInstanceOf(
      SecretBoxError,
    );
  });

  it('rotates to the newest key and still opens secrets sealed with an old one', async () => {
    const v1 = key();
    const old = new SecretBox(new EnvKeyProvider(new Map([[1, v1]])));
    const sealed = await old.seal(secrets, A);

    const v2 = key();
    const rotated = new SecretBox(
      new EnvKeyProvider(
        new Map([
          [1, v1],
          [2, v2],
        ]),
      ),
    );
    expect(rotated.currentVersion).toBe(2);
    // Before rotation, the old version still opens.
    await expect(rotated.open(sealed, A)).resolves.toEqual(secrets);
    const resealed = await rotated.rotate(sealed, A);
    expect(resealed?.keyVersion).toBe(2);
    expect(resealed?.fingerprint).toBe(sealed.fingerprint);
    if (!resealed) throw new Error('not rotated');
    await expect(rotated.open(resealed, A)).resolves.toEqual(secrets);
    // Already current: nothing to do.
    await expect(rotated.rotate(resealed, A)).resolves.toBeNull();
    // Once version 1 is retired, only re-encrypted secrets open.
    const retired = new SecretBox(new EnvKeyProvider(new Map([[2, v2]])));
    await expect(retired.open(sealed, A)).rejects.toBeInstanceOf(SecretBoxError);
  });

  it('fingerprints canonical JSON (key order does not matter)', () => {
    expect(SecretBox.fingerprint({ a: '1', b: '2' })).toBe(
      SecretBox.fingerprint({ b: '2', a: '1' }),
    );
    expect(SecretBox.fingerprint({ a: '1' })).toMatch(/^[0-9a-f]{12}$/);
    expect(SecretBox.fingerprint({ a: '1' })).not.toBe(SecretBox.fingerprint({ a: '2' }));
  });
});

describe('PAYMENT_SECRETS_KEY', () => {
  const b64 = () => key().toString('base64');

  it('parses versioned keys and picks the newest', () => {
    const ring = parseKeyring(`1:${b64()}, 3:${b64()},2:${b64()}`);
    expect([...ring.keys()].sort()).toEqual([1, 2, 3]);
    expect(new EnvKeyProvider(ring).currentVersion).toBe(3);
    expect([...parseKeyring(b64()).keys()]).toEqual([1]);
  });

  it('refuses short keys, repeated versions and garbage', () => {
    expect(() => parseKeyring(randomBytes(16).toString('base64'))).toThrow('32 bytes');
    const k = b64();
    expect(() => parseKeyring(`1:${k},1:${k}`)).toThrow('repeats');
    expect(() => parseKeyring('v1:not a key')).toThrow();
    expect(() => parseKeyring(' , ')).toThrow('no key');
  });

  it('is required in production; development derives a stable key', () => {
    expect(() =>
      createKeyProvider({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(40) }),
    ).toThrow('PAYMENT_SECRETS_KEY is required in production');
    expect(
      createKeyProvider({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'x'.repeat(40),
        PAYMENT_SECRETS_KEY: b64(),
      }).currentVersion,
    ).toBe(1);
    const dev = createKeyProvider({ NODE_ENV: 'development', JWT_ACCESS_SECRET: 'x'.repeat(40) });
    expect(dev.currentVersion).toBe(1);
    expect(
      developmentKey('x'.repeat(40))
        .get(1)
        ?.equals(developmentKey('x'.repeat(40)).get(1) ?? Buffer.alloc(0)),
    ).toBe(true);
    expect(
      developmentKey('x'.repeat(40))
        .get(1)
        ?.equals(developmentKey('y'.repeat(40)).get(1) ?? Buffer.alloc(0)),
    ).toBe(false);
  });
});
