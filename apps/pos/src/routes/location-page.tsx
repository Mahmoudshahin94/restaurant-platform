import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { Button, PageHeader } from '@pos/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useLocations } from '../lib/queries';
import { usePreferences } from '../stores/preferences';

/** Chooses the location this terminal works at; skipped when there is only one. */
export function LocationPage() {
  const { t } = useTranslation('pos');
  const locale = useCurrentLocale();
  const navigate = useNavigate();
  const locations = useLocations();
  const { locationId, setLocationId } = usePreferences();
  const active = locations.data?.filter((l) => l.isActive) ?? [];

  const choose = (id: string) => {
    setLocationId(id);
    void navigate('/order', { replace: true });
  };

  useEffect(() => {
    if (active.length === 1 && active[0] && locationId !== active[0].id) choose(active[0].id);
  });

  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-6">
      <PageHeader title={t('location.title')} />
      <QueryState
        query={locations}
        isEmpty={() => active.length === 0}
        empty={{ title: t('location.none') }}
      >
        {() => (
          <div className="grid gap-3 sm:grid-cols-2">
            {active.map((l) => (
              <Button
                key={l.id}
                size="xl"
                variant={l.id === locationId ? 'primary' : 'outline'}
                className="h-20 justify-start text-xl"
                onClick={() => {
                  choose(l.id);
                }}
              >
                {pickLocalized(l, 'name', locale)}
              </Button>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
