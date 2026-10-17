import { createSessionClient } from '@pos/app-kit';

/** The admin's session: browser app, refresh token in an httpOnly cookie. */
export const session = createSessionClient({
  source: 'ADMIN',
  mode: 'web',
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  validateResponses: import.meta.env.DEV,
});

export const api = session.api;
export const useSession = session.useSession;
