import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long an admin's preview link shows the draft. */
export const PREVIEW_TTL_SECONDS = 30 * 60;

/**
 * Website preview tokens (ADR 0023): `<tenantId>.<expiry>.<signature>`, an HMAC of both. The admin
 * gets one with its access token and opens the tenant's own site with it; the site then shows the
 * draft instead of the published version. Nothing is stored: a token is checked by recomputing
 * its signature in constant time, and it is worth nothing on another tenant's host.
 */
export class WebsitePreviewTokens {
  constructor(private readonly secret: string) {}

  issue(tenantId: string, now = new Date()): { token: string; expiresAt: Date } {
    const expires = Math.floor(now.getTime() / 1000) + PREVIEW_TTL_SECONDS;
    const payload = `${tenantId.toLowerCase()}.${String(expires)}`;
    return { token: `${payload}.${this.sign(payload)}`, expiresAt: new Date(expires * 1000) };
  }

  /** The tenant of a valid, unexpired token, or null. */
  verify(token: string, now = new Date()): string | null {
    if (token.length > 200) return null;
    const [tenantId, expires, signature, ...rest] = token.split('.');
    if (!tenantId || !expires || !signature || rest.length > 0 || !UUID.test(tenantId)) return null;
    if (!/^\d{1,12}$/.test(expires) || Number(expires) * 1000 <= now.getTime()) return null;
    const expected = Buffer.from(this.sign(`${tenantId.toLowerCase()}.${expires}`));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return tenantId.toLowerCase();
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(`website-preview:${payload}`)
      .digest('base64url')
      .slice(0, 32);
  }
}

/** The preview key: its own secret, or one derived from the access-token key. */
export function previewSecret(config: {
  WEBSITE_PREVIEW_SECRET?: string;
  JWT_ACCESS_SECRET: string;
}): string {
  return (
    config.WEBSITE_PREVIEW_SECRET ??
    createHmac('sha256', config.JWT_ACCESS_SECRET).update('website-preview-key').digest('base64url')
  );
}
