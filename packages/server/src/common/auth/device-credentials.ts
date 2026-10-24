import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from '@pos/validation';

/**
 * Device credentials are `<deviceId>.<secret>` with 256 random bits of secret. Only a SHA-256 of
 * the secret is stored: it is high-entropy random data, so a slow password hash adds nothing. The
 * cloud issues a hub's; a hub issues its terminals' (ADR 0022).
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

/** How long a terminal's pairing code works after the admin created it. */
export const PAIRING_CODE_TTL_MS = 24 * 60 * 60_000;

/**
 * A one-time pairing code: 8 characters of an unambiguous alphabet (about 40 bits). Short enough
 * to type on a kiosk; the hub accepts it once, before it expires, and limits wrong attempts.
 */
export function newPairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** `ABCD-EFGH`, as the admin shows it. */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Stored and compared as a hash of the normalized code (`pairTerminalSchema` normalizes input). */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(`pairing:${code}`).digest('hex');
}
