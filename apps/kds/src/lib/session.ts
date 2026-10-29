import { createSessionClient } from '@pos/app-kit';

/**
 * The kitchen screen's session. Web mode: the refresh token is an httpOnly cookie, so a tablet
 * that reloads (or reboots) stays signed in. Device credentials replace staff sign-in once the
 * location hub serves the KDS (Phase 5).
 */
export const session = createSessionClient({
  source: 'KDS',
  mode: 'web',
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  validateResponses: import.meta.env.DEV,
  clientVersion: MADAR_VERSION,
});

export const api = session.api;
export const useSession = session.useSession;
