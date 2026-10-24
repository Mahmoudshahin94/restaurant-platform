import { createStorefrontClient } from '@pos/api-client';
import { previewToken } from './preview';

/**
 * The website's API client: the public storefront and customer orders, no account (ADR 0013).
 * The site and its API share one origin (the tenant's domain, behind the reverse proxy; the Vite
 * proxy in development), and the API finds the tenant from that host name (ADR 0023).
 */
export const storefront = createStorefrontClient({
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  validateResponses: import.meta.env.DEV,
  getPreviewToken: previewToken,
});
