import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Order tracking tokens (ADR 0013): `<orderId>.<signature>`, an HMAC of the order id. Nothing is
 * stored; a token is checked by recomputing its signature in constant time. Whoever holds the
 * token sees the order's status, so it is shown to the customer once and travels in a header.
 */
export class TrackingTokens {
  constructor(private readonly secret: string) {}

  issue(orderId: string): string {
    return `${orderId}.${this.sign(orderId)}`;
  }

  /** The order id of a valid token, or null. */
  verify(token: string): string | null {
    const [orderId, signature, ...rest] = token.split('.');
    if (!orderId || !signature || rest.length > 0 || !UUID.test(orderId)) return null;
    const expected = Buffer.from(this.sign(orderId));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return orderId.toLowerCase();
  }

  private sign(orderId: string): string {
    return createHmac('sha256', this.secret)
      .update(`order-tracking:${orderId.toLowerCase()}`)
      .digest('base64url')
      .slice(0, 32);
  }
}

/** The tracking key: its own secret, or one derived from the access-token key. */
export function trackingSecret(config: {
  TRACKING_TOKEN_SECRET?: string;
  JWT_ACCESS_SECRET: string;
}): string {
  return (
    config.TRACKING_TOKEN_SECRET ??
    createHmac('sha256', config.JWT_ACCESS_SECRET).update('order-tracking-key').digest('base64url')
  );
}
