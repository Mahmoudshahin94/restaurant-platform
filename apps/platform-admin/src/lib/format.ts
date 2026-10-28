import { useCurrentLocale } from '@pos/app-kit';
import { formatDateTime } from '@pos/i18n';
import { useCallback } from 'react';

/** The operator's own time zone: the platform spans businesses in many zones. */
const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Formats UTC instants in the operator's time zone, in the screen's language. */
export function useDateTime() {
  const locale = useCurrentLocale();
  return useCallback(
    (iso: string | null | undefined, fallback = '') =>
      iso ? formatDateTime(iso, LOCAL_ZONE, locale) : fallback,
    [locale],
  );
}
