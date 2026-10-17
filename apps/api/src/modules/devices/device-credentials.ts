import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Device credentials are `<deviceId>.<secret>` with 256 random bits of secret. Only a SHA-256 of
 * the secret is stored: it is high-entropy random data, so a slow password hash adds nothing.
 */
export function newDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function secretMatches(secret: string, storedHash: string): boolean {
  const actual = Buffer.from(hashDeviceSecret(secret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseDeviceCredential(header: string | undefined): {
  deviceId: string;
  secret: string;
} | null {
  if (!header?.startsWith('Device ')) return null;
  const value = header.slice('Device '.length).trim();
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  return { deviceId: value.slice(0, dot), secret: value.slice(dot + 1) };
}
