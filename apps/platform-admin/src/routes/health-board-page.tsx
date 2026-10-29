import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import {
  Badge,
  Card,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ErrorEvents } from '../components/error-events';
import { TenantStatusBadge } from '../components/status-badge';
import { api } from '../lib/api';
import { useDateTime } from '../lib/format';

/**
 * Every business at a glance, refreshed every 30 seconds, with how many of its devices run a
 * version older than its rollout or the cloud's minimum (ADR 0026).
 */
export function HealthBoardPage() {
  const { t } = useTranslation('platform');
  const locale = useCurrentLocale();
  const formatDate = useDateTime();
  const board = useQuery({
    queryKey: ['health-board'],
    queryFn: () => api.health.board(),
    refetchInterval: 30_000,
  });
  const ofTotal = (count: number, total: number) => t('health.ofTotal', { count, total });

  return (
    <div>
      <PageHeader title={t('health.title')} description={t('health.description')} />
      <QueryState
        query={board}
        isEmpty={(d) => d.tenants.length === 0}
        empty={{ title: t('health.empty') }}
      >
        {(data) => (
          <div className="grid gap-6">
            <p className="text-xs text-muted-foreground">
              {t('shared.updatedAt', { at: formatDate(data.generatedAt) })} ·{' '}
              <span dir="ltr">{t('health.cloudVersion', { version: data.cloudVersion })}</span>
            </p>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('tenants.name')}</TableHead>
                    <TableHead>{t('tenants.status')}</TableHead>
                    <TableHead>{t('health.hubs')}</TableHead>
                    <TableHead>{t('health.terminals')}</TableHead>
                    <TableHead>{t('health.pending')}</TableHead>
                    <TableHead>{t('health.failed')}</TableHead>
                    <TableHead>{t('health.openIssues')}</TableHead>
                    <TableHead>{t('health.lastSync')}</TableHead>
                    <TableHead>{t('health.lastActivity')}</TableHead>
                    <TableHead>{t('health.errors24h')}</TableHead>
                    <TableHead>{t('health.versions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.tenants.map((row) => (
                    <TableRow key={row.tenantId}>
                      <TableCell>
                        <Link
                          className="font-medium underline-offset-4 hover:underline"
                          to={`/tenants/${row.tenantId}/health`}
                        >
                          {pickLocalized(row, 'name', locale)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <TenantStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="ltr-nums">
                        <Badge
                          variant={
                            row.hubsTotal === 0
                              ? 'secondary'
                              : row.hubsOnline === row.hubsTotal
                                ? 'success'
                                : 'destructive'
                          }
                        >
                          {ofTotal(row.hubsOnline, row.hubsTotal)}
                        </Badge>
                      </TableCell>
                      <TableCell className="ltr-nums">
                        {ofTotal(row.terminalsOnline, row.terminalsTotal)}
                      </TableCell>
                      <TableCell className="ltr-nums">{row.pendingOperations}</TableCell>
                      <TableCell className="ltr-nums">
                        {row.failedOperations > 0 ? (
                          <Badge variant="destructive">{row.failedOperations}</Badge>
                        ) : (
                          0
                        )}
                      </TableCell>
                      <TableCell className="ltr-nums">
                        {row.openIssues > 0 ? <Badge variant="warning">{row.openIssues}</Badge> : 0}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(row.lastSyncAt, t('shared.never'))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(row.lastActivityAt, t('shared.never'))}
                      </TableCell>
                      <TableCell className="ltr-nums">{row.errors24h}</TableCell>
                      <TableCell>
                        <Link to="/releases" className="flex flex-wrap gap-1">
                          {row.unsupportedDevices > 0 ? (
                            <Badge variant="destructive">
                              {t('releases.unsupportedCount', { count: row.unsupportedDevices })}
                            </Badge>
                          ) : null}
                          {row.outdatedDevices > 0 ? (
                            <Badge variant="warning">
                              {t('releases.outdatedCount', { count: row.outdatedDevices })}
                            </Badge>
                          ) : null}
                          {row.unsupportedDevices + row.outdatedDevices === 0 ? (
                            <Badge variant="success">{t('health.versionsCurrent')}</Badge>
                          ) : null}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <div className="grid gap-3">
              <h2 className="text-lg font-semibold">{t('health.recentErrors')}</h2>
              <ErrorEvents events={data.recentErrors} />
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
