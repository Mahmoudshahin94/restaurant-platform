import { LanguageSwitcher, QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Label, Switch } from '@pos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useKitchenSettings, useLocations } from '../lib/queries';
import { session } from '../lib/session';
import { usePreferences } from '../stores/preferences';

export function SettingsPage() {
  const { t } = useTranslation(['kds', 'common']);
  const locale = useCurrentLocale();
  const navigate = useNavigate();
  const client = useQueryClient();
  const settings = useKitchenSettings();
  const locations = useLocations();
  const { locationId, stationIds, setStationIds, sound, setSound, setLocale } = usePreferences();
  const location = locations.data?.find((l) => l.id === locationId);

  const signOut = async () => {
    await session.signOut();
    client.clear();
    void navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('kds:settings.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <QueryState query={settings}>
            {(data) => (
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-lg font-semibold">{t('kds:settings.stations')}</legend>
                <p className="text-sm text-muted-foreground">{t('kds:settings.stationsHint')}</p>
                {data.stations.map((station) => {
                  const id = `station-${station.id}`;
                  return (
                    <div key={station.id} className="flex items-center gap-3">
                      <Checkbox
                        id={id}
                        className="size-6"
                        checked={stationIds.includes(station.id)}
                        onCheckedChange={(checked) => {
                          setStationIds(
                            checked === true
                              ? [...stationIds, station.id]
                              : stationIds.filter((s) => s !== station.id),
                          );
                        }}
                      />
                      <Label htmlFor={id} className="text-lg">
                        {pickLocalized(station, 'name', locale)}
                      </Label>
                    </div>
                  );
                })}
                <p className="text-sm text-muted-foreground">
                  {t('kds:settings.thresholds', {
                    warn: data.warnMinutes,
                    late: data.lateMinutes,
                  })}
                </p>
              </fieldset>
            )}
          </QueryState>

          <div className="flex items-center gap-3">
            <Switch
              id="sound"
              checked={sound}
              onCheckedChange={(checked) => {
                setSound(checked);
              }}
            />
            <Label htmlFor="sound" className="text-lg">
              {t('kds:settings.sound')}
            </Label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-lg">
              <MapPin aria-hidden className="size-5" />
              {location ? pickLocalized(location, 'name', locale) : null}
            </span>
            {(locations.data?.length ?? 0) > 1 ? (
              <Button
                variant="outline"
                className="h-12"
                onClick={() => {
                  void navigate('/location');
                }}
              >
                {t('kds:settings.location')}
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <LanguageSwitcher className="h-12 w-auto" onLocaleChange={setLocale} />
            <Button variant="outline" className="h-12" onClick={() => void signOut()}>
              <LogOut aria-hidden className="rtl:-scale-x-100" />
              {t('kds:settings.signOut')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
