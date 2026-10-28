import { safeLocalStorage } from '@pos/app-kit';
import type { Locale } from '@pos/shared-types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Per-browser conveniences only (the language). */
interface PreferencesState {
  locale: Locale | null;
  setLocale: (locale: Locale) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: null,
      setLocale: (locale) => {
        set({ locale });
      },
    }),
    { name: 'madar-platform-preferences', storage: createJSONStorage(() => safeLocalStorage) },
  ),
);
