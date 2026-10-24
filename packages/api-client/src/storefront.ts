import {
  type CreateWebOrderRequest,
  publicLocationSchema,
  publicOrderSchema,
  publicSiteSchema,
  publishedMenuSchema,
  webOrderCreatedSchema,
} from '@pos/validation';
import { HttpClient, type HttpClientOptions } from './http';

const API = '/api/v1';

export type StorefrontClientOptions = Omit<
  HttpClientOptions,
  'source' | 'getAccessToken' | 'refreshSession'
> & {
  /** An admin's preview token (ADR 0023): the site then shows the website's draft. */
  getPreviewToken?: () => string | null;
};

/**
 * The customer website's client (ADR 0013): public storefront reads, placing an order, and
 * following it with its tracking token. No account and no access token, and no tenant either:
 * the website is served from the tenant's own domain, and the API (same origin, behind the same
 * proxy) finds the tenant from the host name (ADR 0023).
 */
export function createStorefrontClient(options: StorefrontClientOptions) {
  const { getPreviewToken, ...httpOptions } = options;
  const http = new HttpClient({ ...httpOptions, source: 'WEBSITE', getAccessToken: () => null });
  return {
    http,
    /** The tenant of this host: its names, locations, branding and published website. */
    site: () => {
      const preview = getPreviewToken?.() ?? null;
      return http.request('GET', `${API}/public/site`, {
        ...(preview ? { headers: { 'x-website-preview': preview } } : {}),
        schema: publicSiteSchema,
      });
    },
    location: (locationId: string) =>
      http.request('GET', `${API}/public/site/locations/${locationId}`, {
        schema: publicLocationSchema,
      }),
    menu: (locationId: string) =>
      http.request('GET', `${API}/public/site/locations/${locationId}/menu`, {
        schema: publishedMenuSchema,
      }),
    /** The URL of a file the site shows: its branding's logo and favicon, its section pictures. */
    fileUrl: (fileId: string) => `${options.baseUrl}${API}/public/site/files/${fileId}`,
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
