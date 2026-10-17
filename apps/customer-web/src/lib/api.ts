import { createStorefrontClient } from '@pos/api-client';

/**
 * The website's API client: the public storefront and customer orders, no account (ADR 0013). In
 * development the Vite proxy forwards `/api` to the cloud API.
 */
export const storefront = createStorefrontClient({
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  validateResponses: import.meta.env.DEV,
});

/** Which restaurant this site sells for (one deployment per restaurant brand). */
export const RESTAURANT_SLUG =
  (import.meta.env.VITE_RESTAURANT_SLUG as string | undefined) ?? 'demo-kitchen';
