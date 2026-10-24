import {
  tKey,
  useCurrentLocale,
  useErrorText,
  useFormatOptions,
  usePermissionChecks,
} from '@pos/app-kit';
import { formatDateTime } from '@pos/i18n';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@pos/ui';
import type { HubStatus, HubSyncOperation } from '@pos/validation';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useHubOperations,
  useHubStatus,
  useLocations,
  useRetryOperation,
  useSyncNow,
} from '../lib/queries';
import { useSession } from '../lib/session';
import { usePreferences } from '../stores/preferences';

const TABS = ['PENDING', 'FAILED', 'COMPLETED'] as const;
type Tab = (typeof TABS)[number];

const STATE_VARIANT = {
  ONLINE: 'success',
  OFFLINE: 'warning',
  SYNCING: 'secondary',
  SYNC_ERROR: 'destructive',
} as const;

/** What the hub still has to send, what the cloud refused, and what went through. */
export function SyncPage() {
  const { t } = useTranslation(['pos', 'common']);
  const status = useHubStatus();
  const [tab, setTab] = useState<Tab>('PENDING');
  const syncNow = useSyncNow();
  const errorText = useErrorText();

  if (status.isPending) return <Spinner label={t('common:states.loading')} />;
  if (!status.data) return <EmptyState title={t('pos:sync.notHub')} />;
  const hub = status.data;

  return (
    <div className="mx-auto grid h-full max-w-5xl grid-rows-[auto_auto_auto_1fr] gap-4 overflow-hidden">
      <PageHeader
        title={t('pos:sync.title')}
        description={t('pos:sync.description')}
        actions={
          <Button
            size="lg"
            onClick={() => {
              syncNow.mutate(undefined);
            }}
            disabled={syncNow.isPending}
          >
            <RefreshCw
              aria-hidden
              className={cn(syncNow.isPending && 'motion-safe:animate-spin')}
            />
            {syncNow.isPending ? t('pos:sync.syncing') : t('pos:sync.syncNow')}
          </Button>
        }
      />
      <Summary hub={hub} />
      {syncNow.isError ? <Alert variant="destructive">{errorText(syncNow.error)}</Alert> : null}
      <Operations tab={tab} onTab={setTab} />
    </div>
  );
}

function Summary({ hub }: { hub: HubStatus }) {
  const { t } = useTranslation('pos');
  const locale = useCurrentLocale();
  const formatOptions = useFormatOptions();
  const { locationId } = usePreferences();
  const locations = useLocations();
  const timeZone = locations.data?.find((l) => l.id === locationId)?.timezone ?? 'UTC';
  const when = (iso: string | null) =>
    iso ? formatDateTime(iso, timeZone, locale, formatOptions) : t('sync.figures.never');
  const figures = [
    { label: t('sync.figures.pending'), value: String(hub.pendingOperations) },
    { label: t('sync.figures.failed'), value: String(hub.failedOperations) },
    { label: t('sync.figures.synced'), value: String(hub.syncedOperations) },
    { label: t('sync.figures.lastSync'), value: when(hub.lastSyncAt) },
    ...(hub.nextAttemptAt
      ? [{ label: t('sync.figures.nextAttempt'), value: when(hub.nextAttemptAt) }]
      : []),
  ];
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATE_VARIANT[hub.state]} className="text-sm">
            {t(`hub.${hub.state}`)}
          </Badge>
          <p className="text-sm">{t(`sync.state.${hub.state}`)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {figures.map((f) => (
            <div key={f.label} className="grid gap-1">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
        {hub.lastError && hub.state !== 'ONLINE' ? (
          <p className="text-xs text-muted-foreground" dir="auto">
            {t('sync.lastError', { message: hub.lastError })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Operations({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const { t } = useTranslation(['pos', 'common']);
  const operations = useHubOperations(tab);
  const errorText = useErrorText();

  return (
    <Card className="flex min-h-0 flex-col">
      <div role="tablist" className="flex gap-1 border-b p-2">
        {TABS.map((name) => (
          <Button
            key={name}
            role="tab"
            aria-selected={tab === name}
            variant={tab === name ? 'default' : 'ghost'}
            onClick={() => {
              onTab(name);
            }}
          >
            {t(`pos:sync.tabs.${name}`)}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto" role="tabpanel">
        {operations.isPending ? (
          <Spinner label={t('common:states.loading')} />
        ) : operations.isError ? (
          <Alert
            variant="destructive"
            className="m-4"
            action={
              <Button variant="outline" onClick={() => void operations.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {errorText(operations.error)}
          </Alert>
        ) : operations.data.items.length === 0 ? (
          <EmptyState className="m-4" title={t(`pos:sync.empty.${tab}`)} />
        ) : (
          <OperationTable items={operations.data.items} />
        )}
      </div>
    </Card>
  );
}

function OperationTable({ items }: { items: HubSyncOperation[] }) {
  const { t } = useTranslation(['pos', 'errors']);
  const locale = useCurrentLocale();
  const formatOptions = useFormatOptions();
  const { locationId } = usePreferences();
  const user = useSession((s) => s.user);
  const canRetry = usePermissionChecks(user).canAt(locationId ?? '', 'sync.view');
  const locations = useLocations();
  const timeZone = locations.data?.find((l) => l.id === locationId)?.timezone ?? 'UTC';
  const retry = useRetryOperation();
  const errorText = useErrorText();

  return (
    <>
      {retry.isError ? (
        <Alert variant="destructive" className="m-4">
          {errorText(retry.error)}
        </Alert>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('pos:sync.columns.what')}</TableHead>
            <TableHead>{t('pos:sync.columns.created')}</TableHead>
            <TableHead>{t('pos:sync.columns.status')}</TableHead>
            <TableHead className="text-end">{t('pos:sync.columns.attempts')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((op) => (
            <TableRow key={op.id}>
              <TableCell>
                <div className="font-medium">
                  {tKey(t, `pos:sync.entity.${op.entityType}`)}
                  {op.label ? ` ${op.label}` : ''}
                </div>
                {op.errorCode ? (
                  <div className="text-xs text-destructive">
                    {tKey(t, `errors:${op.errorCode}`)}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDateTime(op.createdAt, timeZone, locale, formatOptions)}
              </TableCell>
              <TableCell>{t(`pos:sync.status.${op.status}`)}</TableCell>
              <TableCell className="text-end tabular-nums">{op.retryCount}</TableCell>
              <TableCell className="text-end">
                {op.status === 'FAILED' ? (
                  canRetry ? (
                    <Button
                      variant="outline"
                      disabled={retry.isPending}
                      onClick={() => {
                        retry.mutate(op.id);
                      }}
                    >
                      {t('pos:sync.retry')}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t('pos:sync.retryDenied')}
                    </span>
                  )
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
