import { RealtimeIndicator, TenantLogo, useCurrentLocale, useRealtime } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { EventType, RealtimeEvent } from '@pos/shared-types';
import { Button, cn } from '@pos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ChefHat, Settings, Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useKitchenSettings, useLocationId, useTickets, ticketsKey } from '../lib/queries';
import { session } from '../lib/session';
import { playChime, soundUnlocked, unlockSound } from '../lib/sound';
import { useNow } from '../lib/time';
import { usePreferences } from '../stores/preferences';

type KitchenEventType = Extract<EventType, `kitchen.${string}`>;

function isKitchenEvent(event: RealtimeEvent): event is RealtimeEvent<KitchenEventType> {
  return event.type.startsWith('kitchen.');
}

/** Top bar for every kitchen view, and the single realtime subscription of the screen. */
export function KdsShell() {
  const { t } = useTranslation(['kds', 'common']);
  const locale = useCurrentLocale();
  const locationId = useLocationId();
  const client = useQueryClient();
  const { stationIds, setStationIds, sound, setSound } = usePreferences();
  const settings = useKitchenSettings();
  const active = useTickets('active');
  const now = useNow(15_000);
  const [unlocked, setUnlocked] = useState(soundUnlocked);

  const status = useRealtime(session, locationId, (event) => {
    if (event.type === 'menu.updated') {
      void client.invalidateQueries({ queryKey: ['kitchen-settings'] });
    }
    if (isKitchenEvent(event) || event.type.startsWith('order.')) {
      void client.invalidateQueries({ queryKey: ticketsKey(locationId) });
    }
    const shown =
      isKitchenEvent(event) &&
      (stationIds.length === 0 || stationIds.includes(event.payload.stationId));
    if (sound && shown && event.type === 'kitchen.ticket_created') playChime();
  });

  const toggleStation = (id: string) => {
    setStationIds(
      stationIds.includes(id) ? stationIds.filter((s) => s !== id) : [...stationIds, id],
    );
  };
  const counts = { NEW: 0, PREPARING: 0, READY: 0 };
  for (const ticket of active.data ?? []) {
    if (ticket.status in counts) counts[ticket.status as keyof typeof counts] += 1;
  }
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'inline-flex h-12 items-center rounded-md px-4 text-lg font-semibold',
      isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
    );

  return (
    <div className="flex h-full flex-col">
      <header className="surface flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <TenantLogo className="shrink-0" />
          <ChefHat aria-hidden className="size-7" />
          <span className="text-xl font-bold">{t('kds:title')}</span>
        </div>
        <nav aria-label={t('kds:nav.main')} className="flex gap-1">
          <NavLink to="/" end className={tab}>
            {t('kds:nav.active')}
          </NavLink>
          <NavLink to="/bumped" className={tab}>
            {t('kds:nav.completed')}
          </NavLink>
        </nav>
        <div role="group" aria-label={t('kds:stations.label')} className="flex flex-wrap gap-1">
          <Button
            variant={stationIds.length === 0 ? 'primary' : 'outline'}
            className="h-12 text-base"
            aria-pressed={stationIds.length === 0}
            onClick={() => {
              setStationIds([]);
            }}
          >
            {t('kds:stations.all')}
          </Button>
          {settings.data?.stations.map((station) => (
            <Button
              key={station.id}
              variant={stationIds.includes(station.id) ? 'primary' : 'outline'}
              className="h-12 text-base"
              aria-pressed={stationIds.includes(station.id)}
              onClick={() => {
                toggleStation(station.id);
              }}
            >
              {pickLocalized(station, 'name', locale)}
            </Button>
          ))}
        </div>
        <p className="flex gap-3 text-base font-medium" aria-live="polite">
          <span>{t('kds:counts.new', { count: counts.NEW })}</span>
          <span>{t('kds:counts.preparing', { count: counts.PREPARING })}</span>
          <span>{t('kds:counts.ready', { count: counts.READY })}</span>
        </p>
        <div className="ms-auto flex items-center gap-3">
          <RealtimeIndicator status={status} className="text-sm" />
          <span className="ltr-nums text-xl font-semibold">
            {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now)}
          </span>
          {sound && !unlocked ? (
            <Button
              variant="outline"
              className="h-12"
              onClick={() => {
                void unlockSound().then(setUnlocked);
              }}
            >
              <Volume2 aria-hidden />
              {t('kds:sound.enable')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-md"
              className="size-12"
              aria-pressed={sound}
              aria-label={sound ? t('kds:sound.on') : t('kds:sound.off')}
              onClick={() => {
                setSound(!sound);
              }}
            >
              {sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
            </Button>
          )}
          <NavLink
            to="/settings"
            aria-label={t('kds:nav.settings')}
            className="inline-flex size-12 items-center justify-center rounded-md hover:bg-muted"
          >
            <Settings aria-hidden className="size-6" />
          </NavLink>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}
