import { createKioskClient } from '@pos/api-client';
import { useDevice } from '../stores/device';

/** The app's version, reported to the hub with every request (ADR 0022). */
export const KIOSK_VERSION = (import.meta.env.VITE_KIOSK_VERSION as string | undefined) ?? '0.0.0';

/** The kiosk talks to its location hub only, with the credential the hub issued. */
export const api = createKioskClient({
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  getCredential: () => useDevice.getState().credential,
  clientVersion: KIOSK_VERSION,
  validateResponses: import.meta.env.DEV,
});
