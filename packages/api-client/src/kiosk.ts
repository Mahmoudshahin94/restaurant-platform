import {
  type CreateKioskOrderRequest,
  type KioskAttendantRequest,
  type PairTerminalRequest,
  kioskAttendantSchema,
  kioskContextSchema,
  kioskPaymentOutcomeSchema,
  orderSchema,
  pairedTerminalSchema,
  publishedMenuSchema,
  resolvedBrandingSchema,
  terminalSchema,
} from '@pos/validation';
import { HttpClient, type HttpClientOptions } from './http';

const API = '/api/v1';

export interface KioskClientOptions extends Omit<
  HttpClientOptions,
  'source' | 'getAccessToken' | 'refreshSession'
> {
  /** The device credential the hub issued at pairing (`<deviceId>.<secret>`), once paired. */
  getCredential: () => string | null;
}

/**
 * The self-service kiosk's client (ADR 0022). It talks to its location hub only, authenticated
 * by the kiosk's device credential: pairing with the admin's code, then its context, the menu,
 * its own orders and their payment at the kiosk's card terminal. No staff session, ever.
 */
export function createKioskClient(options: KioskClientOptions) {
  const http = new HttpClient({
    ...options,
    source: 'KIOSK',
    getAccessToken: () => null,
    getAuthorization: () => {
      const credential = options.getCredential();
      return credential ? `Device ${credential}` : null;
    },
  });
  const location = (locationId: string) => `${API}/locations/${locationId}/kiosk`;
  return {
    http,
    /** Returns the credential once; keep it on the device. */
    pair: (body: PairTerminalRequest) =>
      http.request('POST', `${API}/terminals/pair`, { body, schema: pairedTerminalSchema }),
    /** Who this kiosk is to its hub; 401 once an administrator disabled it. */
    me: () => http.request('GET', `${API}/terminals/me`, { schema: terminalSchema }),
    context: () => http.request('GET', `${API}/kiosk/context`, { schema: kioskContextSchema }),
    /** The published menu; pass the previous version to get `undefined` (304) when unchanged. */
    menu: (locationId: string, previousVersion?: string) =>
      http.request('GET', `${location(locationId)}/menu`, {
        schema: publishedMenuSchema,
        ...(previousVersion ? { headers: { 'if-none-match': `"${previousVersion}"` } } : {}),
      }),
    /** Idempotent by `order.id`: a resend after a lost answer returns the same order. */
    placeOrder: (locationId: string, order: CreateKioskOrderRequest) =>
      http.request('POST', `${location(locationId)}/orders`, { body: order, schema: orderSchema }),
    /** Charges what is due at the kiosk's card terminal; idempotent by the payment id. */
    pay: (locationId: string, orderId: string, paymentId: string) =>
      http.request('POST', `${location(locationId)}/orders/${orderId}/payments`, {
        body: { id: paymentId },
        schema: kioskPaymentOutcomeSchema,
      }),
    cancel: (locationId: string, orderId: string) =>
      http.request('POST', `${location(locationId)}/orders/${orderId}/cancel`, {
        schema: orderSchema,
      }),
    attendant: (body: KioskAttendantRequest) =>
      http.request('POST', `${API}/kiosk/attendant`, { body, schema: kioskAttendantSchema }),
    /** The business's kiosk branding before pairing: the hub's public branding (ADR 0019). */
    hubBranding: () =>
      http.request('GET', `${API}/hub/branding`, {
        query: { surface: 'kiosk' },
        schema: resolvedBrandingSchema,
      }),
    /** The URL of a logo of the tenant's branding, served publicly by the hub (ADR 0019). */
    brandingFileUrl: (fileId: string) => `${options.baseUrl}${API}/hub/branding/files/${fileId}`,
  };
}

export type KioskClient = ReturnType<typeof createKioskClient>;
