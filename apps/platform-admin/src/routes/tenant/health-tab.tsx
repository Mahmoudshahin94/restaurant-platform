import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorEvents } from '../../components/error-events';
import { api } from '../../lib/api';
import { useDateTime } from '../../lib/format';

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="ltr-nums font-medium">{children}</dd>
    </div>
  );
}

/** One business's locations: hubs, terminals, synchronization and recent errors. */
export function HealthTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation(['platform', 'admin']);
  const locale = useCurrentLocale();
  const formatDate = useDateTime();
  const health = useQuery({
    queryKey: ['tenant', tenantId, 'health'],
    queryFn: () => api.tenants.health(tenantId),
    refetchInterval: 30_000,
  });
  return (
    <QueryState query={health}>
      {(data) => (
        <div className="grid gap-4">
          {data.locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('platform:health.noLocations')}</p>
          ) : null}
          {data.locations.map((l) => (
            <Card key={l.locationId}>
              <CardHeader>
                <CardTitle>
                  {pickLocalized(l, 'name', locale)}{' '}
                  <span dir="ltr" className="font-mono text-sm text-muted-foreground">
                    {l.code}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="flex flex-wrap gap-2">
                  {l.hubs.length === 0 ? (
                    <Badge variant="secondary">{t('platform:health.noHub')}</Badge>
                  ) : (
                    l.hubs.map((hub) => (
                      <Badge key={hub.id} variant={hub.online ? 'success' : 'destructive'}>
                        {t('platform:health.hub')} {hub.name}:{' '}
                        {hub.online ? t('platform:health.online') : t('platform:health.offline')}
                        {hub.appVersion ? <span dir="ltr"> · {hub.appVersion}</span> : null}
                      </Badge>
                    ))
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label={t('platform:health.terminals')}>
                    {t('platform:health.ofTotal', {
                      count: l.terminals.online,
                      total: l.terminals.total,
                    })}
                  </Stat>
                  <Stat label={t('platform:health.pending')}>{l.pendingOperations}</Stat>
                  <Stat label={t('platform:health.failed')}>{l.failedOperations}</Stat>
                  <Stat label={t('platform:health.openIssues')}>{l.openIssues}</Stat>
                  <Stat label={t('platform:health.lastSync')}>
                    {formatDate(l.lastSyncAt, t('platform:shared.never'))}
                  </Stat>
                  <Stat label={t('platform:health.lastActivity')}>
                    {formatDate(l.lastActivityAt, t('platform:shared.never'))}
                  </Stat>
                </dl>
              </CardContent>
            </Card>
          ))}
          <h2 className="mt-2 text-lg font-semibold">{t('platform:health.recentErrors')}</h2>
          <ErrorEvents events={data.recentErrors} />
        </div>
      )}
    </QueryState>
  );
}
