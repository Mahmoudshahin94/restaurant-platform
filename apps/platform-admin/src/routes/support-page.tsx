import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { isApiError } from '@pos/api-client';
import { pickLocalized } from '@pos/i18n';
import {
  OrderStatus,
  RestorableEntity,
  SupportFindKind,
  type SupportOperationKey,
  enumValues,
} from '@pos/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@pos/ui';
import type {
  SupportExecution,
  SupportFindQuery,
  SupportPreview,
  SupportRequest,
} from '@pos/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, useSession } from '../lib/api';
import { usePlatformErrorText } from '../lib/errors';
import { useDateTime } from '../lib/format';
import { usePlatformCan } from '../lib/permissions';

const MIN_REASON = 5;

/** Translation keys cannot hold the catalog's dots (`order.correct_status` → `order_correct_status`). */
const operationLabelKey = (key: SupportOperationKey) =>
  key.replaceAll('.', '_') as 'order_correct_status';

interface SelectedTenant {
  id: string;
  name: string;
}

const display = (value: unknown): string =>
  value === null || value === undefined
    ? '—'
    : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : JSON.stringify(value);

/** Finds the business to work on. */
function TenantPicker({ onSelect }: { onSelect: (tenant: SelectedTenant) => void }) {
  const { t } = useTranslation('platform');
  const locale = useCurrentLocale();
  const [search, setSearch] = useState('');
  const term = search.trim();
  const tenants = useQuery({
    queryKey: ['tenants', { search: term, page: 1, pageSize: 10 }],
    queryFn: () => api.tenants.list({ search: term, page: 1, pageSize: 10 }),
    enabled: term.length > 0,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('support.tenant')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Field label={t('support.chooseTenant')}>
          <Input
            type="search"
            value={search}
            placeholder={t('tenants.searchPlaceholder')}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </Field>
        {tenants.data ? (
          <div className="flex flex-wrap gap-2">
            {tenants.data.items.map((tenant) => (
              <Button
                key={tenant.id}
                variant="outline"
                size="sm"
                onClick={() => {
                  onSelect({ id: tenant.id, name: pickLocalized(tenant, 'name', locale) });
                }}
              >
                {pickLocalized(tenant, 'name', locale)}
                <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                  {tenant.slug}
                </span>
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Looks a record up inside the business: read-only. */
function FindPanel({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation('platform');
  const errorText = usePlatformErrorText();
  const formatDate = useDateTime();
  const [kind, setKind] = useState<SupportFindQuery['kind']>('ORDER');
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState<SupportFindQuery | null>(null);
  const found = useQuery({
    queryKey: ['support-find', tenantId, submitted],
    queryFn: () => (submitted ? api.support.find(tenantId, submitted) : null),
    enabled: submitted !== null,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('support.find')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) setSubmitted({ kind, q: q.trim() });
          }}
        >
          <Field label={t('support.findKind')}>
            <NativeSelect
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as SupportFindQuery['kind']);
              }}
            >
              {enumValues(SupportFindKind).map((k) => (
                <option key={k} value={k}>
                  {t(`support.kinds.${k}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('support.findQuery')}>
            <Input
              dir="ltr"
              value={q}
              placeholder={t('support.findPlaceholder')}
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
          </Field>
          <Button type="submit" disabled={!q.trim()}>
            {t('support.find')}
          </Button>
        </form>
        {submitted && found.isError ? (
          <Alert variant="destructive">{errorText(found.error)}</Alert>
        ) : null}
        {found.data ? (
          found.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('support.noResults')}</p>
          ) : (
            <ul className="grid gap-2">
              {found.data.items.map((item) => (
                <li key={`${item.kind}-${item.id}`} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t(`support.kinds.${item.kind}`)}</Badge>
                    <span className="font-medium">{item.title}</span>
                    {item.status ? <Badge variant="secondary">{item.status}</Badge> : null}
                    {item.createdAt ? (
                      <span className="text-xs text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </span>
                    ) : null}
                  </div>
                  {item.subtitle ? <p className="text-muted-foreground">{item.subtitle}</p> : null}
                  <p dir="ltr" className="font-mono text-xs text-muted-foreground">
                    {item.id}
                  </p>
                  <pre dir="ltr" className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-xs">
                    {JSON.stringify(item.data, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

type Params = Record<string, string>;

function requestOf(operation: SupportOperationKey, p: Params): SupportRequest {
  switch (operation) {
    case 'sync.retry':
    case 'sync.reprocess':
      return { operation, params: { operationId: p.operationId ?? '' } };
    case 'order.correct_status':
      return {
        operation,
        params: { orderId: p.orderId ?? '', to: (p.to ?? 'CANCELLED') as OrderStatus },
      };
    case 'order_item.correct_product':
      return {
        operation,
        params: {
          orderItemId: p.orderItemId ?? '',
          productId: p.productId ?? '',
          variantId: p.variantId?.trim() ? p.variantId.trim() : null,
        },
      };
    case 'order.recalculate_totals':
      return { operation, params: { orderId: p.orderId ?? '' } };
    case 'entity.restore':
      return {
        operation,
        params: {
          entityType: (p.entityType ?? 'PRODUCT') as RestorableEntity,
          entityId: p.entityId ?? '',
        },
      };
  }
}

const FIELDS: Record<SupportOperationKey, readonly string[]> = {
  'sync.retry': ['operationId'],
  'sync.reprocess': ['operationId'],
  'order.correct_status': ['orderId', 'to'],
  'order_item.correct_product': ['orderItemId', 'productId', 'variantId'],
  'order.recalculate_totals': ['orderId'],
  'entity.restore': ['entityType', 'entityId'],
};

/** Seconds until a preview's confirmation stops working. */
function useSecondsLeft(expiresAt: string | null): number {
  const left = () =>
    expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)) : 0;
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!expiresAt) return undefined;
    const timer = setInterval(() => {
      setSeconds(left());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);
  return seconds;
}

function ChangesTable({ preview }: { preview: Pick<SupportPreview, 'changes'> }) {
  const { t } = useTranslation('platform');
  if (preview.changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('support.noChanges')}</p>;
  }
  return (
    <Table data-testid="support-changes">
      <TableHeader>
        <TableRow>
          <TableHead>{t('support.field')}</TableHead>
          <TableHead>{t('support.before')}</TableHead>
          <TableHead>{t('support.after')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {preview.changes.map((change) => (
          <TableRow key={change.field}>
            <TableCell dir="ltr" className="text-start font-mono text-xs">
              {change.field}
            </TableCell>
            <TableCell dir="ltr" className="text-start font-mono text-xs">
              {display(change.before)}
            </TableCell>
            <TableCell dir="ltr" className="text-start font-mono text-xs">
              {display(change.after)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A repair: preview → confirm with a reason → execute (ADR 0025). */
export function RepairPanel({ tenant }: { tenant: SelectedTenant }) {
  const { t } = useTranslation(['platform', 'orders', 'common']);
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const role = useSession((s) => s.user?.role ?? null);
  const operations = useQuery({
    queryKey: ['support-operations'],
    queryFn: () => api.support.operations(),
  });
  const [operation, setOperation] = useState<SupportOperationKey | null>(null);
  const [params, setParams] = useState<Params>({ to: 'CANCELLED', entityType: 'PRODUCT' });
  const [preview, setPreview] = useState<SupportPreview | null>(null);
  const [step, setStep] = useState<'edit' | 'preview' | 'confirm'>('edit');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null);
  const [result, setResult] = useState<SupportExecution | null>(null);
  const seconds = useSecondsLeft(preview?.confirmation?.expiresAt ?? null);
  const previewMutation = useMutation({
    mutationFn: (request: SupportRequest) => api.support.preview(tenant.id, request),
  });
  const executeMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.support.execute>[1]) =>
      api.support.execute(tenant.id, body),
  });

  const allowed = (operations.data ?? []).filter((op) => role !== null && op.roles.includes(role));
  const current = operation ?? allowed[0]?.key ?? null;

  const reset = () => {
    setPreview(null);
    setStep('edit');
    setReason('');
    setError(null);
  };

  const runPreview = async () => {
    if (!current) return;
    setError(null);
    setResult(null);
    try {
      const next = await previewMutation.mutateAsync(requestOf(current, params));
      setPreview(next);
      setStep('preview');
    } catch (e) {
      setError({ text: errorText(e), stale: false });
    }
  };

  const execute = async () => {
    if (!current || !preview?.confirmation) return;
    setError(null);
    try {
      const done = await executeMutation.mutateAsync({
        ...requestOf(current, params),
        confirmationToken: preview.confirmation.token,
        reason: reason.trim(),
      });
      setResult(done);
      reset();
      // What the search shows changed: look it up again.
      void queryClient.invalidateQueries({ queryKey: ['support-find', tenant.id] });
    } catch (e) {
      const stale = isApiError(e) && e.code === 'SUPPORT_PREVIEW_STALE';
      setError({ text: errorText(e), stale });
    }
  };

  if (operations.isSuccess && allowed.length === 0) {
    return <Alert data-testid="no-repairs">{t('platform:support.noRepairs')}</Alert>;
  }

  const paramField = (name: string) => {
    const label = t(`platform:support.params.${name as 'orderId'}`);
    if (name === 'to') {
      return (
        <Field key={name} label={label}>
          <NativeSelect
            value={params.to ?? 'CANCELLED'}
            disabled={step !== 'edit'}
            onChange={(e) => {
              setParams((p) => ({ ...p, to: e.target.value }));
            }}
          >
            {enumValues(OrderStatus).map((s) => (
              <option key={s} value={s}>
                {t(`orders:status.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      );
    }
    if (name === 'entityType') {
      return (
        <Field key={name} label={label}>
          <NativeSelect
            value={params.entityType ?? 'PRODUCT'}
            disabled={step !== 'edit'}
            onChange={(e) => {
              setParams((p) => ({ ...p, entityType: e.target.value }));
            }}
          >
            {enumValues(RestorableEntity).map((s) => (
              <option key={s} value={s}>
                {t(`platform:support.entityTypes.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      );
    }
    return (
      <Field key={name} label={label}>
        <Input
          dir="ltr"
          className="font-mono"
          value={params[name] ?? ''}
          disabled={step !== 'edit'}
          onChange={(e) => {
            setParams((p) => ({ ...p, [name]: e.target.value }));
          }}
        />
      </Field>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('platform:support.repair')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <QueryState query={operations}>
          {() => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('platform:support.operation')}>
                <NativeSelect
                  value={current ?? ''}
                  disabled={step !== 'edit'}
                  onChange={(e) => {
                    setOperation(e.target.value as SupportOperationKey);
                    reset();
                  }}
                >
                  {allowed.map((op) => (
                    <option key={op.key} value={op.key}>
                      {t(`platform:support.operations.${operationLabelKey(op.key)}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {current ? FIELDS[current].map(paramField) : null}
            </div>
          )}
        </QueryState>

        {error ? (
          <Alert
            variant="destructive"
            action={
              error.stale ? (
                <Button size="sm" variant="outline" onClick={() => void runPreview()}>
                  {t('platform:support.previewAgain')}
                </Button>
              ) : undefined
            }
          >
            {error.text}
          </Alert>
        ) : null}

        {step === 'edit' ? (
          <div>
            <Button
              disabled={!current || previewMutation.isPending}
              onClick={() => void runPreview()}
            >
              {previewMutation.isPending
                ? t('platform:support.previewing')
                : t('platform:support.preview')}
            </Button>
          </div>
        ) : null}

        {preview && step !== 'edit' ? (
          <div className="grid gap-3 rounded-md border p-4" data-testid="support-preview">
            <p className="font-medium">{t('platform:support.previewTitle')}</p>
            <p className="text-sm">
              {t('platform:support.record')}: {preview.entity.label}{' '}
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                {preview.entity.type} {preview.entity.id}
              </span>
            </p>
            <ChangesTable preview={preview} />
            {!preview.executable ? (
              <Alert variant="destructive">
                {t('platform:support.blocked', { reason: preview.blockedReason ?? '' })}
              </Alert>
            ) : seconds > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('platform:support.expiresIn', { seconds })}
              </p>
            ) : (
              <Alert variant="destructive">{t('platform:support.expired')}</Alert>
            )}
            {step === 'confirm' ? (
              <div className="grid gap-3">
                <p className="font-medium">{t('platform:support.confirmTitle')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('platform:support.confirmDescription', { name: tenant.name })}
                </p>
                <Field label={t('platform:shared.reason')} hint={t('platform:shared.reasonHint')}>
                  <Textarea
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                    }}
                  />
                </Field>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reset}>
                {t('common:actions.back')}
              </Button>
              {step === 'preview' ? (
                <Button
                  disabled={!preview.executable || seconds <= 0}
                  onClick={() => {
                    setStep('confirm');
                  }}
                >
                  {t('platform:support.confirm')}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={reason.trim().length < MIN_REASON || executeMutation.isPending}
                  onClick={() => void execute()}
                >
                  {executeMutation.isPending
                    ? t('platform:support.executing')
                    : t('platform:support.execute')}
                </Button>
              )}
              {seconds <= 0 && preview.executable ? (
                <Button variant="outline" onClick={() => void runPreview()}>
                  {t('platform:support.previewAgain')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {result ? (
          <Alert data-testid="support-result" title={t('platform:support.done')}>
            <p>
              {t('platform:support.doneDescription', {
                operation: t(`platform:support.operations.${operationLabelKey(result.operation)}`),
                record: result.entity.label,
              })}
            </p>
            <ChangesTable preview={result} />
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Find records of a business and repair them safely, every step audited. */
export function SupportPage() {
  const { t } = useTranslation('platform');
  const can = usePlatformCan();
  const [tenant, setTenant] = useState<SelectedTenant | null>(null);
  return (
    <div className="grid gap-4">
      <PageHeader title={t('support.title')} description={t('support.description')} />
      {tenant ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-medium">{t('support.selectedTenant', { name: tenant.name })}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTenant(null);
              }}
            >
              {t('support.changeTenant')}
            </Button>
          </div>
          <FindPanel tenantId={tenant.id} />
          {can('support.repair') ? (
            <RepairPanel key={tenant.id} tenant={tenant} />
          ) : (
            <Alert data-testid="no-repairs">{t('support.noRepairs')}</Alert>
          )}
        </>
      ) : (
        <TenantPicker onSelect={setTenant} />
      )}
    </div>
  );
}
