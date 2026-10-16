import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with the OWASP-recommended baseline (19 MiB, 2 iterations, 1 lane). Used for user
 * passwords, employee PINs and device credentials. Lives here so the API and the seed hash
 * identically.
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashSecret(secret: string): Promise<string> {
  return hash(secret, ARGON2_OPTIONS);
}

export async function verifySecret(storedHash: string, secret: string): Promise<boolean> {
  try {
    return await verify(storedHash, secret);
  } catch {
    // A malformed stored hash must never authenticate.
    return false;
  }
}
