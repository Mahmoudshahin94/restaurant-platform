import type { Locale } from '@pos/shared-types';
import { create } from 'zustand';
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware';

/**
 * Per-browser conveniences only (language, last selected location). Storage can be unavailable
 * (private mode, blocked site data), so every access is guarded and the app works without it.
 */
const safeLocalStorage: StateStorage = {
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
      // ignore: preferences are optional
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

interface PreferencesState {
  locale: Locale | null;
  locationId: string | null;
  setLocale: (locale: Locale) => void;
  setLocationId: (locationId: string | null) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: null,
      locationId: null,
      setLocale: (locale) => {
        set({ locale });
      },
      setLocationId: (locationId) => {
        set({ locationId });
      },
    }),
    { name: 'pos-admin-preferences', storage: createJSONStorage(() => safeLocalStorage) },
  ),
);
