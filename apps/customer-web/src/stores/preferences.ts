import { safeLocalStorage } from '@pos/app-kit';
import type { Locale } from '@pos/shared-types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface PreferencesState {
  locale: Locale | null;
  setLocale: (locale: Locale) => void;
}

/** The visitor's language, remembered on this browser. */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: null,
      setLocale: (locale) => {
        set({ locale });
      },
    }),
    { name: 'web-preferences', storage: createJSONStorage(() => safeLocalStorage), version: 1 },
  ),
);
