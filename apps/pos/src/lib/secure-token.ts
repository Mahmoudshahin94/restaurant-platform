import type { RefreshTokenStore } from '@pos/app-kit';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './device';

/** The native side of the token store (`secure_token_*` commands in src-tauri/src/lib.rs). */
export interface SecureTokenBackend {
  read: () => Promise<string | null>;
  write: (token: string | null) => Promise<void>;
}

const tauriBackend: SecureTokenBackend = {
  read: () => invoke<string | null>('secure_token_get'),
  write: (token) => invoke('secure_token_set', { token }),
};

export interface PersistentTokenStore extends RefreshTokenStore {
  /** Loads the stored token once, before the first refresh; failures leave it signed out. */
  hydrate: () => Promise<void>;
}

/**
 * The refresh token of the till's session (ADR 0016). In the desktop app it is kept in the OS's
 * secure storage, so restarting the POS mid-shift keeps its cashier signed in; reads come from a
 * copy in memory, writes go to both. In a browser (development, E2E tests) it stays in memory
 * only, as before: no web storage ever holds it.
 */
export function createPersistentTokenStore(
  backend: SecureTokenBackend | null = isTauri() ? tauriBackend : null,
): PersistentTokenStore {
  let token: string | null = null;
  // Writes are chained so a rotation and a sign-out can never land out of order.
  let writes: Promise<void> = Promise.resolve();
  return {
    get: () => token,
    set: (value) => {
      token = value;
      if (!backend) return;
      writes = writes
        .then(() => backend.write(value))
        .catch(() => {
          // Secure storage unavailable: the session still works, it just won't survive a restart.
        });
    },
    hydrate: async () => {
      if (!backend) return;
      try {
        token ??= await backend.read();
      } catch {
        token = null;
      }
    },
  };
}
