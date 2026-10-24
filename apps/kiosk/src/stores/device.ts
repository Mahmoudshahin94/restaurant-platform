import { safeLocalStorage } from '@pos/app-kit';
import type { PairedTerminal, Terminal } from '@pos/validation';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The kiosk's identity at its hub (ADR 0022): the device credential the hub issued when it was
 * paired, kept on this device only. Forgetting it (unpairing, or the hub refusing it) brings back
 * the pairing screen.
 */
interface DeviceState {
  credential: string | null;
  device: Terminal | null;
  paired: (result: PairedTerminal) => void;
  forget: () => void;
}

export const useDevice = create<DeviceState>()(
  persist(
    (set) => ({
      credential: null,
      device: null,
      paired: ({ credential, device }) => {
        set({ credential, device });
      },
      forget: () => {
        set({ credential: null, device: null });
      },
    }),
    {
      name: 'madar-kiosk-device',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 1,
    },
  ),
);
