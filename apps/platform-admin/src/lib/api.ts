import { createPlatformSessionClient } from '@pos/app-kit';

/** The operator's session: browser app, refresh token in an httpOnly cookie (ADR 0025). */
export const session = createPlatformSessionClient({
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  validateResponses: import.meta.env.DEV,
  clientVersion: MADAR_VERSION,
});

export const api = session.api;
export const useSession = session.useSession;
