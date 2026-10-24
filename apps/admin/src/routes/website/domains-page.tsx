import { QueryState } from '@pos/app-kit';
import { DomainStatus, MAX_CUSTOM_DOMAINS } from '@pos/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PageHeader,
} from '@pos/ui';
import type { TenantDomainDto } from '@pos/validation';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useAdminMutation, useTenantId } from '../../lib/queries';

const STATUS_VARIANT: Record<DomainStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  VERIFIED: 'default',
  PENDING: 'secondary',
  FAILED: 'destructive',
  DISABLED: 'outline',
};

/** Selects the text of a DNS value so it can be copied in one go. */
function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <Input
        readOnly
        dir="ltr"
        className="font-mono text-xs"
        value={value}
        onFocus={(e) => {
          e.currentTarget.select();
        }}
      />
    </Field>
  );
}

function DomainCard({
  domain,
  onError,
}: {
  domain: TenantDomainDto;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation(['admin']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const verify = useAdminMutation(() => api.admin.domains.verify(tid, domain.id), ['domains']);
  const primary = useAdminMutation(() => api.admin.domains.setPrimary(tid, domain.id), ['domains']);
  const disable = useAdminMutation(() => api.admin.domains.disable(tid, domain.id), ['domains']);
  const busy = verify.isPending || primary.isPending || disable.isPending;
  const run = async (action: { mutateAsync: (v: undefined) => Promise<unknown> }) => {
    onError(null);
    try {
      await action.mutateAsync(undefined);
    } catch (error) {
      onError(errorText(error));
    }
  };
  const verified = domain.status === DomainStatus.VERIFIED;
  const custom = domain.kind === 'CUSTOM';

  return (
    <Card data-testid="domain-card">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle className="break-all text-base" dir="ltr">
            {domain.domain}
          </CardTitle>
          <CardDescription>
            {custom ? t('admin:domains.kinds.CUSTOM') : t('admin:domains.kinds.SUBDOMAIN')}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {domain.isPrimary ? <Badge>{t('admin:domains.primary')}</Badge> : null}
          <Badge variant={STATUS_VARIANT[domain.status]}>
            {t(`admin:domains.statuses.${domain.status}`)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {custom && !verified && domain.verification ? (
          <div className="grid gap-3 rounded-md border bg-muted p-3">
            <p className="text-sm">{t('admin:domains.instructions')}</p>
            <div className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
              <CopyValue label={t('admin:domains.recordType')} value={domain.verification.type} />
              <CopyValue label={t('admin:domains.recordName')} value={domain.verification.name} />
              <CopyValue label={t('admin:domains.recordValue')} value={domain.verification.value} />
            </div>
            <p className="text-xs text-muted-foreground">{t('admin:domains.pointHint')}</p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {custom && !verified ? (
            <Button disabled={busy} onClick={() => void run(verify)}>
              {verify.isPending ? t('admin:domains.verifying') : t('admin:domains.verify')}
            </Button>
          ) : null}
          {verified && !domain.isPrimary ? (
            <Button variant="outline" disabled={busy} onClick={() => void run(primary)}>
              {t('admin:domains.makePrimary')}
            </Button>
          ) : null}
          {custom && !domain.isPrimary && domain.status !== DomainStatus.DISABLED ? (
            <Button variant="ghost" disabled={busy} onClick={() => void run(disable)}>
              {t('admin:domains.disable')}
            </Button>
          ) : null}
          {verified ? (
            <a
              href={domain.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium hover:bg-muted"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t('admin:domains.open')}
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The website's domains (ADR 0023): MADAR's own address, and custom domains the tenant proves it
 * controls with a DNS TXT record. Only verified domains serve the site; the primary one is its
 * address.
 */
export function DomainsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const domains = useQuery({
    queryKey: ['domains', tid],
    queryFn: () => api.admin.domains.list(tid),
  });
  const add = useAdminMutation((domain: string) => api.admin.domains.add(tid, domain), ['domains']);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const customCount = (domains.data ?? []).filter((d) => d.kind === 'CUSTOM').length;

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await add.mutateAsync(name);
      setName('');
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader title={t('admin:domains.title')} description={t('admin:domains.description')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('admin:domains.addTitle')}</CardTitle>
          <CardDescription>
            {t('admin:domains.addHint', { max: MAX_CUSTOM_DOMAINS })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void submit(e)}>
            <Field label={t('admin:domains.domain')} className="min-w-64 flex-1">
              <Input
                dir="ltr"
                placeholder={t('admin:domains.placeholder')}
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </Field>
            <Button
              type="submit"
              disabled={add.isPending || name.trim() === '' || customCount >= MAX_CUSTOM_DOMAINS}
            >
              {t('admin:domains.add')}
            </Button>
          </form>
        </CardContent>
      </Card>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <QueryState query={domains}>
        {(list) => (
          <div className="grid gap-4">
            {list.map((domain) => (
              <DomainCard key={domain.id} domain={domain} onError={setError} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
