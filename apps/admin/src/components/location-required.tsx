import { EmptyState } from '@pos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreferences } from '../stores/preferences';

/** Renders location-scoped pages for the location chosen in the header. */
export function LocationRequired({ children }: { children: (locationId: string) => ReactNode }) {
  const { t } = useTranslation('admin');
  const locationId = usePreferences((s) => s.locationId);
  if (!locationId) {
    return (
      <EmptyState title={t('shared.chooseLocation')} description={t('shared.chooseLocationHint')} />
    );
  }
  return <>{children(locationId)}</>;
}
