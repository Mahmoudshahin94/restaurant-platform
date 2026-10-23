import { useCurrentLocale } from '@pos/app-kit';
import { formatDateTime, pickLocalized } from '@pos/i18n';
import type { Location } from '@pos/validation';
import { useCallback, useMemo } from 'react';
import { useLocations, useTenant } from './queries';

/** Location names and time zones by id, for lists that span locations. */
export function useLocationLookup() {
  const locale = useCurrentLocale();
  const locations = useLocations();
  const tenant = useTenant();
  const byId = useMemo(
    () => new Map((locations.data ?? []).map((l) => [l.id, l] as const)),
    [locations.data],
  );
  const name = useCallback(
    (id: string | null) => {
      const location = id ? byId.get(id) : undefined;
      return location ? pickLocalized(location, 'name', locale) : '';
    },
    [byId, locale],
  );
  /** The location's time zone, else the tenant's. */
  const timeZone = useCallback(
    (id: string | null): string =>
      (id ? byId.get(id)?.timezone : undefined) ?? tenant.data?.timezone ?? 'UTC',
    [byId, tenant.data],
  );
  return { list: locations.data ?? ([] as Location[]), byId, name, timeZone };
}

/** Formats UTC instants in a location's time zone (presentation only). */
export function useDateTime() {
  const locale = useCurrentLocale();
  const { timeZone } = useLocationLookup();
  return useCallback(
    (iso: string | null, locationId: string | null = null) =>
      iso ? formatDateTime(iso, timeZone(locationId), locale) : '',
    [locale, timeZone],
  );
}
