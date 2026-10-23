import { createSessionClient } from '@pos/app-kit';
import { createPersistentTokenStore } from './secure-token';

/** The session's refresh token: OS secure storage in the desktop app, memory in a browser. */
export const refreshTokens = createPersistentTokenStore();

/**
 * The POS session. Native mode: the refresh token comes back in the body and is kept by
 * `refreshTokens`, so the desktop app keeps its cashier signed in across a restart (ADR 0016).
 *
 * In development the Tauri webview and the browser both load the Vite dev server, which proxies
 * `/api`; production builds set VITE_API_URL.
 */
export const session = createSessionClient({
  source: 'POS',
  mode: 'native',
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  validateResponses: import.meta.env.DEV,
  tokenStore: refreshTokens,
});

export const api = session.api;
export const useSession = session.useSession;
