import { QueryState, useCurrentLocale, useMoneyFormat } from '@pos/app-kit';
import { formatDateTime, pickLocalized } from '@pos/i18n';
import type { DashboardLocation } from '@pos/validation';
import {
  Badge,
  type BadgeProps,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { keys, useTenantId } from '../lib/queries';
import { usePermissions } from '../lib/permissions';
import { usePreferences } from '../stores/preferences';
import { useSession } from '../stores/session';

const HUB_VARIANT: Record<NonNullable<DashboardLocation['sync']>['hub'], BadgeProps['variant']> = {
  NOT_PAIRED: 'outline',
  ONLINE: 'success',
  OFFLINE: 'warning',
  DISABLED: 'destructive',
};

const ONLINE_VARIANT: Record<DashboardLocation['onlineOrdering']['state'], BadgeProps['variant']> =
  {
    OPEN: 'success',
    PAUSED: 'warning',
    CLOSED: 'secondary',
    OFFLINE: 'destructive',
  };

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="ltr-nums text-lg font-semibold">{value}</span>
    </div>
  );
}

function LocationCard({ row, currency }: { row: DashboardLocation; currency: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(currency);
  const { canAt } = usePermissions();
  const setLocationId = usePreferences((s) => s.setLocationId);
  const sync = row.sync;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle>{pickLocalized(row, 'name', locale)}</CardTitle>
          <p className="text-xs text-muted-foreground">
            <span className="ltr-nums">{row.code}</span> ·{' '}
            {t('admin:dashboard.businessDay', { date: row.businessDate })}
          </p>
        </div>
        {row.isActive ? null : <Badge variant="secondary">{t('admin:dashboard.inactive')}</Badge>}
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label={t('admin:dashboard.orders')} value={String(row.orders.count)} />
          <Figure label={t('admin:dashboard.open')} value={String(row.orders.open)} />
          <Figure label={t('admin:dashboard.sales')} value={format(row.sales.total)} />
          <Figure label={t('admin:dashboard.collected')} value={format(row.sales.paid)} />
          <Figure label={t('admin:dashboard.cancelled')} value={String(row.orders.cancelled)} />
          <Figure label={t('admin:dashboard.openShifts')} value={String(row.openShifts)} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('admin:dashboard.online')}</span>
          <Badge variant={ONLINE_VARIANT[row.onlineOrdering.state]}>
            {t(`admin:onlineState.${row.onlineOrdering.state}`)}
          </Badge>
          {row.onlineOrdering.reason ? (
            <span className="text-xs text-muted-foreground">
              {t(`admin:onlineReason.${row.onlineOrdering.reason}`)}
            </span>
          ) : null}
        </div>
        {sync ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('admin:dashboard.hub')}</span>
            <Badge variant={HUB_VARIANT[sync.hub]}>
              {t(`admin:dashboard.hubState.${sync.hub}`)}
            </Badge>
            {sync.lastSeenAt ? (
              <span className="text-xs text-muted-foreground">
                {t('admin:dashboard.lastSeen', {
                  time: formatDateTime(sync.lastSeenAt, row.timezone, locale),
                })}
              </span>
            ) : null}
            {sync.pending !== null && sync.failed !== null ? (
              <span className="ltr-nums text-xs text-muted-foreground">
                {t('admin:dashboard.outbox', { pending: sync.pending, failed: sync.failed })}
              </span>
            ) : null}
            {sync.openIssues > 0 && canAt(row.locationId, 'sync.view') ? (
              <Link
                to="/system/sync"
                className="text-xs font-medium text-destructive underline"
                onClick={() => {
                  setLocationId(row.locationId);
                }}
              >
                {t('admin:dashboard.issues')}: <span className="ltr-nums">{sync.openIssues}</span>
              </Link>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation('admin');
  const user = useSession((s) => s.user);
  const tid = useTenantId();
  const { canAnywhere } = usePermissions();
  const query = useQuery({
    queryKey: keys.dashboard(tid),
    queryFn: () => api.admin.dashboard(tid),
    enabled: canAnywhere('orders.view'),
    refetchInterval: 60_000,
  });
  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={`${t('dashboard.welcome', { name: user?.displayName ?? '' })} · ${t('dashboard.subtitle')}`}
      />
      {canAnywhere('orders.view') ? (
        <QueryState
          query={query}
          isEmpty={(d) => d.locations.length === 0}
          empty={{ title: t('dashboard.empty'), description: t('dashboard.emptyHint') }}
        >
          {(data) => (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.locations.map((row) => (
                <LocationCard key={row.locationId} row={row} currency={data.currencyCode} />
              ))}
            </div>
          )}
        </QueryState>
      ) : (
        <EmptyState title={t('dashboard.empty')} description={t('dashboard.emptyHint')} />
      )}
    </>
  );
}
