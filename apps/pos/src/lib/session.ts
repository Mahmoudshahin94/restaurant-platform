import { createSessionClient } from '@pos/app-kit';

/**
 * The POS session. Native mode: the refresh token comes back in the body and is kept in memory
 * (staff sign in again after a restart). With the location hub (Phase 5) staff will sign in with
 * a PIN verified locally, and the device credential will live in OS secure storage.
 *
 * In development the Tauri webview and the browser both load the Vite dev server, which proxies
 * `/api`; production builds set VITE_API_URL.
 */
export const session = createSessionClient({
  source: 'POS',
  mode: 'native',
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  validateResponses: import.meta.env.DEV,
});

export const api = session.api;
export const useSession = session.useSession;
