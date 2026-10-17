import type { StateStorage } from 'zustand/middleware';

/**
 * localStorage that never throws. Storage can be unavailable (private mode, blocked site data,
 * locked-down kiosks), so it is only used for per-device conveniences, never for business data.
 */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // optional
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // optional
    }
  },
};
