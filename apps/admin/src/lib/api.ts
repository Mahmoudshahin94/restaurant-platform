import { createApiClient } from '@pos/api-client';
import { useSession } from '../stores/session';

let inFlight: Promise<boolean> | null = null;

/**
 * Restores/extends the session from the refresh cookie. Shared by bootstrap and 401 retries,
 * and single-flight: refresh tokens rotate on every use, so concurrent calls must not each
 * present the same token.
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= (async () => {
    try {
      const session = await api.auth.refresh();
      useSession.getState().setSession(session.accessToken, session.user);
      return true;
    } catch {
      useSession.getState().clear();
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export const api = createApiClient({
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  source: 'ADMIN',
  getAccessToken: () => useSession.getState().accessToken,
  refreshSession,
  validateResponses: import.meta.env.DEV,
});
