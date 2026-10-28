import { useCurrentLocale } from '@pos/app-kit';
import { TENANT_STATUS_TRANSITIONS } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { TenantStatus } from '@pos/shared-types';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  NativeSelect,
  Textarea,
} from '@pos/ui';
import type { PlatformTenantDetail } from '@pos/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TenantStatusBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { usePlatformErrorText } from '../../lib/errors';
import { useDateTime } from '../../lib/format';
import { usePlatformCan } from '../../lib/permissions';

const MIN_REASON = 5;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

/** Suspend, reactivate or archive, with a reason (both audit logs record it). */
function StatusDialog({ detail }: { detail: PlatformTenantDetail }) {
  const { t } = useTranslation(['platform', 'common']);
  const locale = useCurrentLocale();
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const allowed = TENANT_STATUS_TRANSITIONS[detail.tenant.status];
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<TenantStatus>(allowed[0] ?? detail.tenant.status);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api.tenants.setStatus(detail.tenant.id, { status, reason }),
  });

  const submit = async () => {
    setError(null);
    try {
      const updated = await change.mutateAsync();
      queryClient.setQueryData(['tenant', detail.tenant.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['tenants'] });
      setOpen(false);
      setReason('');
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setStatus(allowed[0] ?? detail.tenant.status);
        setError(null);
      }}
    >
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('platform:tenant.changeStatus')}
      </Button>
      <DialogContent closeLabel={t('common:actions.close')}>
        <DialogHeader>
          <DialogTitle>
            {t('platform:tenant.statusTitle', {
              name: pickLocalized(detail.tenant, 'name', locale),
            })}
          </DialogTitle>
          <DialogDescription>{t('platform:tenant.statusDescription')}</DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Field label={t('platform:tenant.newStatus')}>
          <NativeSelect
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as TenantStatus);
            }}
          >
            {allowed.map((s) => (
              <option key={s} value={s}>
                {t(`platform:statuses.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('platform:shared.reason')} hint={t('platform:shared.reasonHint')}>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant={status === 'ACTIVE' ? 'default' : 'destructive'}
            disabled={reason.trim().length < MIN_REASON || change.isPending}
            onClick={() => void submit()}
          >
            {t('common:actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OverviewTab({ detail }: { detail: PlatformTenantDetail }) {
  const { t } = useTranslation(['platform', 'admin', 'common']);
  const formatDate = useDateTime();
  const can = usePlatformCan();
  const { tenant } = detail;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>{t('platform:tenant.profile')}</CardTitle>
          {can('tenants.status') ? <StatusDialog detail={detail} /> : null}
        </CardHeader>
        <CardContent>
          <dl>
            <Row label={t('platform:tenants.status')}>
              <TenantStatusBadge status={tenant.status} />
            </Row>
            <Row label={t('platform:tenants.businessType')}>
              {t(`admin:tenant.businessTypes.${tenant.businessType}`)}
            </Row>
            <Row label={t('platform:provision.nameEn')}>{tenant.nameEn}</Row>
            <Row label={t('platform:provision.nameAr')}>{tenant.nameAr}</Row>
            <Row label={t('platform:provision.legalName')}>{tenant.legalName ?? '—'}</Row>
            <Row label={t('platform:tenant.currency')}>{tenant.currencyCode}</Row>
            <Row label={t('platform:tenant.locales')}>
              {tenant.supportedLocales.map((l) => t(`common:language.${l}`)).join(' · ')}
            </Row>
            <Row label={t('platform:tenant.timezone')}>
              <span dir="ltr">{tenant.timezone}</span>
            </Row>
            <Row label={t('platform:tenants.domain')}>
              <span dir="ltr" className="font-mono text-xs">
                {detail.primaryDomain ?? '—'}
              </span>
            </Row>
            <Row label={t('platform:tenants.created')}>{formatDate(tenant.createdAt)}</Row>
          </dl>
        </CardContent>
      </Card>
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('platform:tenant.counts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="ltr-nums">
              <Row label={t('platform:tenants.locations')}>{detail.counts.locations}</Row>
              <Row label={t('platform:tenants.users')}>{detail.counts.users}</Row>
              <Row label={t('platform:tenant.devices')}>{detail.counts.devices}</Row>
              <Row label={t('platform:tenant.orders')}>{detail.counts.orders}</Row>
              <Row label={t('platform:tenant.lastActivity')}>
                {formatDate(detail.lastActivityAt, t('platform:shared.never'))}
              </Row>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('platform:tenant.owners')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {detail.owners.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('platform:tenant.noOwner')}</p>
            ) : (
              detail.owners.map((owner) => (
                <div key={owner.id} className="text-sm">
                  <p className="font-medium">{owner.displayName}</p>
                  <p dir="ltr" className="text-start text-muted-foreground">
                    {owner.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('platform:tenant.lastLogin')}:{' '}
                    {formatDate(owner.lastLoginAt, t('platform:shared.never'))}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
