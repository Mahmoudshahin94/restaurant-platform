import { type ApiClient, createApiClient } from '@pos/api-client';
import type { ActionSource } from '@pos/shared-types';
import type { AuthUser } from '@pos/validation';
import { type StoreApi, type UseBoundStore, create } from 'zustand';

export interface SessionState {
  status: 'unknown' | 'authenticated' | 'anonymous';
  accessToken: string | null;
  user: AuthUser | null;
  setSession: (accessToken: string, user: AuthUser) => void;
  clear: () => void;
}

/**
 * Where a native client keeps its refresh token. The default is memory only (sign in again after
 * a restart); a Tauri app can plug in OS secure storage later.
 */
export interface RefreshTokenStore {
  get: () => string | null;
  set: (token: string | null) => void;
}

export interface SessionClientOptions {
  source: ActionSource;
  /**
   * `web`: refresh token in an httpOnly cookie (same-origin browser apps).
   * `native`: refresh token returned in the body and kept by `tokenStore` (desktop/hub clients).
   */
  mode: 'web' | 'native';
  baseUrl?: string;
  validateResponses?: boolean;
  tokenStore?: RefreshTokenStore;
}

export interface SessionClient {
  useSession: UseBoundStore<StoreApi<SessionState>>;
  api: ApiClient;
  /** Single-flight: concurrent callers share one refresh request (tokens rotate on use). */
  refreshSession: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
}

function memoryTokenStore(): RefreshTokenStore {
  let token: string | null = null;
  return {
    get: () => token,
    set: (value) => {
      token = value;
    },
  };
}

/** Builds the session store and an authenticated API client for one app. */
export function createSessionClient(options: SessionClientOptions): SessionClient {
  const tokens = options.tokenStore ?? memoryTokenStore();
  const useSession = create<SessionState>()((set) => ({
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
        if (options.mode === 'native' && !tokens.get()) throw new Error('no refresh token');
        const session = await api.auth.refresh(
          options.mode === 'native' ? (tokens.get() ?? undefined) : undefined,
        );
        if (options.mode === 'native') tokens.set(session.refreshToken ?? null);
        useSession.getState().setSession(session.accessToken, session.user);
        return true;
      } catch {
        tokens.set(null);
        useSession.getState().clear();
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const api: ApiClient = createApiClient({
    baseUrl: options.baseUrl ?? '',
    source: options.source,
    getAccessToken: () => useSession.getState().accessToken,
    refreshSession,
    validateResponses: options.validateResponses ?? false,
  });

  return {
    useSession,
    api,
    refreshSession,
    async signIn(email, password) {
      const session = await api.auth.login({ email, password, client: options.mode });
      if (options.mode === 'native') tokens.set(session.refreshToken ?? null);
      useSession.getState().setSession(session.accessToken, session.user);
      return session.user;
    },
    async signOut() {
      try {
        await api.auth.logout(options.mode === 'native' ? (tokens.get() ?? undefined) : undefined);
      } finally {
        tokens.set(null);
        useSession.getState().clear();
      }
    },
  };
}
