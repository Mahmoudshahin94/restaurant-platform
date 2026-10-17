import { safeLocalStorage } from '@pos/app-kit';
import type { Locale } from '@pos/shared-types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Per-screen settings: language, location, which stations this screen shows, sound. */
interface PreferencesState {
  locale: Locale | null;
  locationId: string | null;
  /** Empty = every station (expo view). */
  stationIds: string[];
  sound: boolean;
  setLocale: (locale: Locale) => void;
  setLocationId: (locationId: string | null) => void;
  setStationIds: (stationIds: string[]) => void;
  setSound: (sound: boolean) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: null,
      locationId: null,
      stationIds: [],
      sound: true,
      setLocale: (locale) => {
        set({ locale });
      },
      setLocationId: (locationId) => {
        set({ locationId, stationIds: [] });
      },
      setStationIds: (stationIds) => {
        set({ stationIds });
      },
      setSound: (sound) => {
        set({ sound });
      },
    }),
    {
      name: 'kds-screen-preferences',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 1,
    },
  ),
);
