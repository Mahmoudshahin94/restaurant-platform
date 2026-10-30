import { safeLocalStorage } from '@pos/app-kit';
import type { PaperWidth } from '@pos/receipts';
import type { Locale } from '@pos/shared-types';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type PrinterConfig =
  | { kind: 'browser'; paper: PaperWidth }
  | { kind: 'network'; host: string; port: number; paper: PaperWidth };

/**
 * Per-terminal settings: language, location, the shift this terminal works in, printer, and
 * whether its menu shows product pictures (ADR 0027; a fast text-only till can turn them off).
 */
interface PreferencesState {
  locale: Locale | null;
  locationId: string | null;
  shiftId: string | null;
  printer: PrinterConfig;
  showPictures: boolean;
  setLocale: (locale: Locale) => void;
  setLocationId: (locationId: string | null) => void;
  setShiftId: (shiftId: string | null) => void;
  setPrinter: (printer: PrinterConfig) => void;
  setShowPictures: (showPictures: boolean) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      locale: null,
      locationId: null,
      shiftId: null,
      printer: { kind: 'browser', paper: '80mm' },
      showPictures: true,
      setLocale: (locale) => {
        set({ locale });
      },
      setLocationId: (locationId) => {
        set({ locationId, shiftId: null });
      },
      setShiftId: (shiftId) => {
        set({ shiftId });
      },
      setPrinter: (printer) => {
        set({ printer });
      },
      setShowPictures: (showPictures) => {
        set({ showPictures });
      },
    }),
    {
      name: 'pos-terminal-preferences',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 1,
    },
  ),
);
