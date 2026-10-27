// Exact names for short keys that would otherwise match innocent words ("shipping", "company").
const SENSITIVE_EXACT =
  /^(pin|pin_?hash|pin_?code|cvv|cvc|pan|card_?number|authorization|cookie)$/i;
// Payment provider secrets (ADR 0024) under any name a gateway uses, and sealed bytes.
const SENSITIVE_SUBSTRING =
  /password|passphrase|secret|token|credential|(api|private|signing|access|webhook)_?key|ciphertext|wrapped_?key/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_EXACT.test(key) || SENSITIVE_SUBSTRING.test(key);
}
const MAX_DEPTH = 6;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Deep-copies audit metadata into plain JSON, replacing values of sensitive-looking keys with
 * "[REDACTED]". Audit logs are long-lived and widely readable; secrets must never land there.
 */
export function redactForAudit(value: unknown, depth = 0): Json {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redactForAudit(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? '[REDACTED]' : redactForAudit(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return typeof value === 'bigint' ? value.toString() : '[UNSERIALIZABLE]';
}
