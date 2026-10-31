import { QueryState, tKey, useMoneyFormat } from '@pos/app-kit';
import type { AdminSyncIssue, SyncEntityVersion, SyncIssueDetail } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { LocationRequired } from '../../components/location-required';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useDateTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { keys, useAdminMutation } from '../../lib/queries';

type State = 'open' | 'resolved' | 'all';
const STATES: State[] = ['open', 'resolved', 'all'];

function entityLabel(t: (...args: never[]) => unknown, issue: AdminSyncIssue): string {
  return `${tKey(t, `admin:sync.entity.${issue.entityType}`)}${issue.label ? ` ${issue.label}` : ''}`;
}

function Outcome({ issue }: { issue: AdminSyncIssue }) {
  const { t } = useTranslation('admin');
  if (issue.resolution)
    return <Badge variant="success">{t(`sync.resolution.${issue.resolution}`)}</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="destructive">{t(`sync.status.${issue.status}`)}</Badge>
      {issue.resendRequestedAt ? (
        <Badge variant="outline">{t('sync.resendRequested')}</Badge>
      ) : null}
    </span>
  );
}

function SyncOverview({ locationId }: { locationId: string }) {
  const { t } = useTranslation(['admin', 'errors']);
  const formatDate = useDateTime();
  const [state, setState] = useState<State>('open');
  const status = useQuery({
    queryKey: keys.syncStatus(locationId),
    queryFn: () => api.admin.sync.status(locationId),
    refetchInterval: 30_000,
  });
  const issues = useQuery({
    queryKey: keys.syncIssues(locationId, { state }),
    queryFn: () => api.admin.sync.issues(locationId, { state }),
  });
  return (
    <div className="grid gap-6">
      <QueryState query={status}>
        {(s) => (
          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t('admin:sync.hub')}</span>
                {s.hubs.length === 0 ? (
                  <span className="text-sm">{t('admin:sync.noHub')}</span>
                ) : (
                  s.hubs.map((h) => (
                    <span key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                      {h.name}
                      <Badge
                        variant={
                          h.status !== 'ACTIVE' ? 'secondary' : h.online ? 'success' : 'warning'
                        }
                      >
                        {h.status !== 'ACTIVE'
                          ? t(`admin:devices.statuses.${h.status}`)
                          : h.online
                            ? t('admin:devices.online')
                            : t('admin:devices.offline')}
                      </Badge>
                      {h.outbox ? (
                        <span className="ltr-nums text-xs text-muted-foreground">
                          {t('admin:devices.outboxValue', {
                            pending: h.outbox.pending,
                            failed: h.outbox.failed,
                          })}
                        </span>
                      ) : null}
                    </span>
                  ))
                )}
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t('admin:sync.openIssues')}</span>
                <span className="ltr-nums text-lg font-semibold">{s.openIssues}</span>
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  {t('admin:sync.lastReceived')}
                </span>
                <span className="text-sm">
                  {s.lastReceivedAt
                    ? formatDate(s.lastReceivedAt, locationId)
                    : t('admin:shared.never')}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </QueryState>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t('admin:sync.issues')}</h2>
          <div role="tablist" aria-label={t('admin:sync.issues')} className="flex gap-1">
            {STATES.map((s) => (
              <Button
                key={s}
                role="tab"
                aria-selected={state === s}
                size="sm"
                variant={state === s ? 'primary' : 'outline'}
                onClick={() => {
                  setState(s);
                }}
              >
                {t(`admin:sync.states.${s}`)}
              </Button>
            ))}
          </div>
        </div>
        <QueryState
          query={issues}
          isEmpty={(rows) => rows.length === 0}
          empty={{ title: t('admin:sync.noIssues'), description: t('admin:sync.noIssuesHint') }}
        >
          {(rows) => (
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin:sync.columns.change')}</TableHead>
                    <TableHead>{t('admin:sync.columns.problem')}</TableHead>
                    <TableHead>{t('admin:sync.columns.outcome')}</TableHead>
                    <TableHead>{t('admin:sync.columns.attempts')}</TableHead>
                    <TableHead>{t('admin:sync.columns.when')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((issue) => (
                    <TableRow key={issue.operationId}>
                      <TableCell className="font-medium">
                        <Link
                          className="hover:underline"
                          to={`/system/sync/${locationId}/${issue.operationId}`}
                        >
                          {entityLabel(t, issue)}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-md">
                        {issue.errorCode ? tKey(t, `errors:${issue.errorCode}`) : ''}
                        {issue.errorMessage ? (
                          <div className="text-xs text-muted-foreground" dir="ltr">
                            {issue.errorMessage}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Outcome issue={issue} />
                      </TableCell>
                      <TableCell className="ltr-nums">{issue.attempts}</TableCell>
                      <TableCell>{formatDate(issue.updatedAt, locationId)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </QueryState>
      </div>
    </div>
  );
}

export function SyncPage() {
  const { t } = useTranslation('admin');
  return (
    <>
      <PageHeader title={t('sync.title')} description={t('sync.description')} />
      <LocationRequired>
        {(locationId) => <SyncOverview key={locationId} locationId={locationId} />}
      </LocationRequired>
    </>
  );
}

// --- Issue detail -----------------------------------------------------------------------------

const FIELDS = [
  'label',
  'status',
  'paymentStatus',
  'total',
  'itemCount',
  'paymentCount',
  'paidTotal',
  'version',
  'updatedAt',
] as const;
type FieldKey = (typeof FIELDS)[number];
const MONEY: readonly FieldKey[] = ['total', 'paidTotal'];
const ACTIONS = ['APPLY_HUB', 'KEEP_CLOUD', 'RESEND'] as const;
type Action = (typeof ACTIONS)[number];

function Comparison({ detail, locationId }: { detail: SyncIssueDetail; locationId: string }) {
  const { t } = useTranslation(['admin', 'orders']);
  const { format } = useMoneyFormat();
  const formatDate = useDateTime();
  const show = (version: SyncEntityVersion | null, field: FieldKey): string => {
    const value = version?.[field];
    if (value === null || value === undefined) return '';
    if (MONEY.includes(field) && typeof value === 'number') return format(value);
    if (field === 'updatedAt' && typeof value === 'string') return formatDate(value, locationId);
    if (field === 'status' && typeof value === 'string' && detail.issue.entityType === 'Order') {
      return tKey(t, `orders:status.${value}`);
    }
    if (field === 'paymentStatus' && typeof value === 'string')
      return tKey(t, `orders:payment.${value}`);
    return String(value);
  };
  const rows = FIELDS.filter(
    (f) => detail.hubVersion?.[f] != null || detail.cloudVersion?.[f] != null,
  );
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead>{t('admin:sync.detail.hubVersion')}</TableHead>
            <TableHead>{t('admin:sync.detail.cloudVersion')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.hubVersion === null || detail.cloudVersion === null ? (
            <TableRow>
              <TableCell />
              <TableCell className="text-muted-foreground">
                {detail.hubVersion === null ? t('admin:sync.detail.noHubVersion') : ''}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {detail.cloudVersion === null ? t('admin:sync.detail.notInCloud') : ''}
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((field) => {
            const hub = show(detail.hubVersion, field);
            const cloud = show(detail.cloudVersion, field);
            const differs =
              detail.hubVersion !== null && detail.cloudVersion !== null && hub !== cloud;
            return (
              <TableRow key={field} className={cn(differs && 'bg-warning/10')}>
                <TableCell className="text-muted-foreground">
                  {t(`admin:sync.detail.fields.${field}`)}
                  {differs ? (
                    <Badge variant="warning" className="ms-2">
                      {t('admin:sync.detail.differs')}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="ltr-nums">{hub}</TableCell>
                <TableCell className="ltr-nums">{cloud}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <details className="border-t p-4 text-xs">
        <summary className="cursor-pointer text-sm">{t('admin:sync.detail.rawData')}</summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <pre dir="ltr" className="max-h-96 overflow-auto rounded bg-muted p-2 text-start">
            {JSON.stringify(detail.hubVersion?.data ?? null, null, 2)}
          </pre>
          <pre dir="ltr" className="max-h-96 overflow-auto rounded bg-muted p-2 text-start">
            {JSON.stringify(detail.cloudVersion?.data ?? null, null, 2)}
          </pre>
        </div>
      </details>
    </Card>
  );
}

function Decision({
  detail,
  locationId,
  onDone,
}: {
  detail: SyncIssueDetail;
  locationId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options: Record<Action, SyncIssueDetail['options']['applyHub']> = {
    APPLY_HUB: detail.options.applyHub,
    KEEP_CLOUD: detail.options.keepCloud,
    RESEND: detail.options.resend,
  };
  const resolve = useAdminMutation(
    (body: { action: Action; note: string }) =>
      api.admin.sync.resolve(locationId, detail.issue.operationId, body),
    ['sync-issue', 'sync-issues', 'sync-status', 'dashboard', 'orders', 'order'],
  );
  const noteValid = note.trim().length >= 3;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin:sync.detail.decision')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <div role="radiogroup" aria-label={t('admin:sync.detail.decision')} className="grid gap-2">
          {ACTIONS.map((a) => {
            const option = options[a];
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={action === a}
                disabled={!option.allowed}
                onClick={() => {
                  setAction(a);
                }}
                className={cn(
                  'grid gap-1 rounded-md border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  action === a ? 'border-primary bg-primary/5' : 'hover:bg-muted',
                )}
              >
                <span className="font-medium">{t(`admin:sync.detail.actions.${a}`)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`admin:sync.detail.explain.${a}`)}
                </span>
                {!option.allowed && option.reason ? (
                  <span className="text-xs text-destructive">
                    {tKey(t, `admin:reasons.${option.reason}`)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <Field label={t('admin:sync.detail.note')} hint={t('admin:sync.detail.noteHint')}>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </Field>
        <div>
          <Button
            disabled={action === null || !noteValid || resolve.isPending}
            onClick={() => {
              if (!action) return;
              setError(null);
              resolve.mutateAsync({ action, note: note.trim() }).then(
                () => {
                  setAction(null);
                  setNote('');
                  onDone();
                },
                (e: unknown) => {
                  setError(errorText(e));
                },
              );
            }}
          >
            {t('admin:sync.detail.confirm')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IssueDetail({ detail, locationId }: { detail: SyncIssueDetail; locationId: string }) {
  const { t } = useTranslation(['admin', 'errors']);
  const formatDate = useDateTime();
  const { canAt } = usePermissions();
  const issue = detail.issue;
  const open = detail.issue.resolution === null && issue.status !== 'APPLIED';
  // Shown above the issue: once settled, the decision form is gone.
  const [done, setDone] = useState(false);
  return (
    <div className="grid gap-6">
      {done ? <Alert>{t('admin:sync.detail.done')}</Alert> : null}
      <Alert>{t('admin:sync.detail.rule')}</Alert>
      <Card>
        <CardHeader>
          <CardTitle>{t('admin:sync.detail.problem')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Outcome issue={issue} />
            {issue.errorCode ? <span>{tKey(t, `errors:${issue.errorCode}`)}</span> : null}
          </div>
          {issue.errorMessage ? (
            <p dir="ltr" className="text-start text-xs text-muted-foreground">
              {issue.errorMessage}
            </p>
          ) : null}
          {issue.resolution && issue.resolvedAt ? (
            <p>
              {t('admin:sync.detail.decided', {
                resolution: t(`admin:sync.resolution.${issue.resolution}`),
                name: issue.resolvedBy ?? t('admin:shared.unknown'),
                time: formatDate(issue.resolvedAt, locationId),
              })}
              {issue.resolutionNote ? ` — ${issue.resolutionNote}` : ''}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Comparison detail={detail} locationId={locationId} />
      {open ? (
        canAt(locationId, 'sync.resolve') ? (
          <Decision
            detail={detail}
            locationId={locationId}
            onDone={() => {
              setDone(true);
            }}
          />
        ) : (
          <Alert>{t('admin:sync.detail.noResolve')}</Alert>
        )
      ) : null}
    </div>
  );
}

export function SyncIssuePage() {
  const { t } = useTranslation('admin');
  const { locationId = '', operationId = '' } = useParams();
  const query = useQuery({
    queryKey: keys.syncIssue(locationId, operationId),
    queryFn: () => api.admin.sync.issue(locationId, operationId),
  });
  return (
    <>
      <div className="mb-2">
        <Link
          to="/system/sync"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          {t('sync.detail.back')}
        </Link>
      </div>
      <PageHeader
        title={query.data ? entityLabel(t, query.data.issue) : t('sync.detail.title')}
        description={t('sync.detail.title')}
      />
      <QueryState query={query}>
        {(detail) => <IssueDetail detail={detail} locationId={locationId} />}
      </QueryState>
    </>
  );
}
