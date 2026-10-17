import { safeLocalStorage } from '@pos/app-kit';
import type { Locale } from '@pos/shared-types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Per-browser conveniences only (language, last selected location). */
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
