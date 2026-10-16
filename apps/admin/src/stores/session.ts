import type { AuthUser } from '@pos/validation';
import { create } from 'zustand';

/**
 * In-memory session. The access token is never persisted; on reload the app restores the
 * session from the httpOnly refresh cookie (see RequireAuth).
 */
interface SessionState {
  status: 'unknown' | 'authenticated' | 'anonymous';
  accessToken: string | null;
  user: AuthUser | null;
  setSession: (accessToken: string, user: AuthUser) => void;
  clear: () => void;
}

export const useSession = create<SessionState>()((set) => ({
  status: 'unknown',
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => {
    set({ status: 'authenticated', accessToken, user });
  },
  clear: () => {
    set({ status: 'anonymous', accessToken: null, user: null });
  },
}));
