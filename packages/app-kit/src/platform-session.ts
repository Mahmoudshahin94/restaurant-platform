import { type PlatformApiClient, createPlatformApiClient } from '@pos/api-client';
import type { PlatformUserDto } from '@pos/validation';
import { type StoreApi, type UseBoundStore, create } from 'zustand';

export interface PlatformSessionState {
  status: 'unknown' | 'authenticated' | 'anonymous';
  accessToken: string | null;
  user: PlatformUserDto | null;
  setSession: (accessToken: string, user: PlatformUserDto) => void;
  clear: () => void;
}

export interface PlatformSessionClientOptions {
  baseUrl?: string;
  validateResponses?: boolean;
}

export interface PlatformSessionClient {
  useSession: UseBoundStore<StoreApi<PlatformSessionState>>;
  api: PlatformApiClient;
  /** Single-flight: concurrent callers share one refresh request (tokens rotate on use). */
  refreshSession: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<PlatformUserDto>;
  signOut: () => Promise<void>;
}

/**
 * The platform admin's session (ADR 0025): a platform operator, never a tenant's staff. Browser
 * only, so the refresh token lives in the httpOnly cookie scoped to `/api/v1/platform/auth`.
 */
export function createPlatformSessionClient(
  options: PlatformSessionClientOptions = {},
): PlatformSessionClient {
  const useSession = create<PlatformSessionState>()((set) => ({
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

  let inFlight: Promise<boolean> | null = null;
  const refreshSession = (): Promise<boolean> => {
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
  };

  const api = createPlatformApiClient({
    baseUrl: options.baseUrl ?? '',
    // The platform's guard records its own source; this header is informational only.
    source: 'ADMIN',
    getAccessToken: () => useSession.getState().accessToken,
    refreshSession,
    validateResponses: options.validateResponses ?? false,
  });

  return {
    useSession,
    api,
    refreshSession,
    async signIn(email, password) {
      const session = await api.auth.login({ email, password });
      useSession.getState().setSession(session.accessToken, session.user);
      return session.user;
    },
    async signOut() {
      try {
        await api.auth.logout();
      } finally {
        useSession.getState().clear();
      }
    },
  };
}
