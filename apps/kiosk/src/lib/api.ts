import { createKioskClient } from '@pos/api-client';
import { reportUpgradeRequired } from '@pos/app-kit';
import { useDevice } from '../stores/device';

/** The kiosk talks to its location hub only, with the credential the hub issued. */
export const api = createKioskClient({
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  getCredential: () => useDevice.getState().credential,
  // Reported to the hub with every request (ADR 0022, ADR 0026).
  clientVersion: MADAR_VERSION,
  onUpgradeRequired: reportUpgradeRequired,
  validateResponses: import.meta.env.DEV,
});
