import {
  type CreateWebOrderRequest,
  publicLocationSchema,
  publicOrderSchema,
  publicTenantSchema,
  publishedMenuSchema,
  webOrderCreatedSchema,
} from '@pos/validation';
import { HttpClient, type HttpClientOptions } from './http';

const API = '/api/v1';

export type StorefrontClientOptions = Omit<
  HttpClientOptions,
  'source' | 'getAccessToken' | 'refreshSession'
>;

/**
 * The customer website's client (ADR 0013): public storefront reads, placing an order, and
 * following it with its tracking token. No account and no access token.
 */
export function createStorefrontClient(options: StorefrontClientOptions) {
  const http = new HttpClient({ ...options, source: 'WEBSITE', getAccessToken: () => null });
  return {
    http,
    tenant: (slug: string) =>
      http.request('GET', `${API}/public/tenants/${encodeURIComponent(slug)}`, {
        schema: publicTenantSchema,
      }),
    location: (locationId: string) =>
      http.request('GET', `${API}/public/locations/${locationId}`, {
        schema: publicLocationSchema,
      }),
    menu: (locationId: string) =>
      http.request('GET', `${API}/public/locations/${locationId}/menu`, {
        schema: publishedMenuSchema,
      }),
    /** The URL of a logo or favicon of the tenant's branding (public files, ADR 0019). */
    brandingFileUrl: (slug: string, fileId: string) =>
      `${options.baseUrl}${API}/public/tenants/${encodeURIComponent(slug)}/files/${fileId}`,
    /** Idempotent by `order.id`: resending after a lost response returns the same order. */
    placeOrder: (order: CreateWebOrderRequest) =>
      http.request('POST', `${API}/orders`, { body: order, schema: webOrderCreatedSchema }),
    /** The token goes in a header, never the URL, so it stays out of logs. */
    track: (trackingToken: string) =>
      http.request('GET', `${API}/orders/track`, {
        headers: { 'x-tracking-token': trackingToken },
        schema: publicOrderSchema,
      }),
  };
}

export type StorefrontClient = ReturnType<typeof createStorefrontClient>;
