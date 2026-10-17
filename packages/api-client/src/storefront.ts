import {
  type CreateWebOrderRequest,
  publicLocationSchema,
  publicOrderSchema,
  publicRestaurantSchema,
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
    restaurant: (slug: string) =>
      http.request('GET', `${API}/public/restaurants/${encodeURIComponent(slug)}`, {
        schema: publicRestaurantSchema,
      }),
    location: (locationId: string) =>
      http.request('GET', `${API}/public/locations/${locationId}`, {
        schema: publicLocationSchema,
      }),
    menu: (locationId: string) =>
      http.request('GET', `${API}/public/locations/${locationId}/menu`, {
        schema: publishedMenuSchema,
      }),
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
