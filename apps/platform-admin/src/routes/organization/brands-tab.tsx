import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import {
  Alert,
  AlertDialog,
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  toast,
} from '@pos/ui';
import type { PlatformOrganizationDetail, PlatformTenantSummary } from '@pos/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Unlink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TenantStatusBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { usePlatformErrorText } from '../../lib/errors';
import { usePlatformCan } from '../../lib/permissions';
import { ProvisionDialog } from '../provision-dialog';
import { invalidateOrganization } from './organization-queries';

type Brand = PlatformOrganizationDetail['brands'][number];

/** Brands that are in no organization yet, to bring into this one. */
function AttachBrandDialog({
  organization,
  open,
  onOpenChange,
}: {
  organization: PlatformOrganizationDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['platform', 'admin', 'common']);
  const locale = useCurrentLocale();
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const candidates = useQuery({
    queryKey: ['tenants', 'attachable', search.trim()],
    queryFn: () =>
      api.tenants.list({ pageSize: 50, ...(search.trim() ? { search: search.trim() } : {}) }),
    enabled: open,
  });
  const attach = useMutation({
    mutationFn: (tenant: PlatformTenantSummary) =>
      api.organizations.attach(organization.id, tenant.id),
  });

  const close = (next: boolean) => {
    if (!next) {
      setSearch('');
      setError(null);
    }
    onOpenChange(next);
  };

  const onAttach = async (tenant: PlatformTenantSummary) => {
    setError(null);
    try {
      const result = await attach.mutateAsync(tenant);
      await invalidateOrganization(queryClient, organization.id);
      const brand = pickLocalized(tenant, 'name', locale);
      toast({
        title: t('platform:organization.brands.attached', { brand }),
        ...(result.skippedMemberIds.length > 0
          ? { description: t('platform:organization.brands.skipped', { brand }) }
          : {}),
        variant: 'success',
      });
      close(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const free = (candidates.data?.items ?? []).filter((tenant) => tenant.organization === null);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent closeLabel={t('common:actions.close')} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t('platform:organization.brands.attachTitle', {
              name: pickLocalized(organization, 'name', locale),
            })}
          </DialogTitle>
          <DialogDescription>
            {t('platform:organization.brands.attachDescription', {
              currency: organization.currencyCode,
            })}
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Field label={t('common:actions.search')}>
          <Input
            type="search"
            value={search}
            placeholder={t('platform:tenants.searchPlaceholder')}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </Field>
        <QueryState
          query={candidates}
          isEmpty={() => free.length === 0}
          empty={{ title: t('platform:organization.brands.attachNone') }}
        >
          {() => (
            <ul className="grid max-h-72 gap-2 overflow-y-auto">
              {free.map((tenant) => (
                <li
                  key={tenant.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {pickLocalized(tenant, 'name', locale)}
                    </span>
                    <span dir="ltr" className="block font-mono text-xs text-muted-foreground">
                      {tenant.slug} · {tenant.currencyCode}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={attach.isPending}
                    aria-label={`${t('platform:organization.brands.attachAction')}: ${pickLocalized(tenant, 'name', locale)}`}
                    onClick={() => void onAttach(tenant)}
                  >
                    <Link2 aria-hidden />
                    {t('platform:organization.brands.attachAction')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </DialogContent>
    </Dialog>
  );
}

/** The organization's brands: attach an existing one, create a new one inside it, detach one. */
export function BrandsTab({ organization }: { organization: PlatformOrganizationDetail }) {
  const { t } = useTranslation(['platform', 'common']);
  const locale = useCurrentLocale();
  const can = usePlatformCan();
  const manage = can('organizations.manage');
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [attaching, setAttaching] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [detaching, setDetaching] = useState<Brand | null>(null);
  const detach = useMutation({
    mutationFn: (brand: Brand) => api.organizations.detach(organization.id, brand.id),
  });

  // A refusal (the brand has no owner of its own yet) shows in the dialog, which stays open.
  const onDetach = async (brand: Brand) => {
    await detach.mutateAsync(brand);
    await invalidateOrganization(queryClient, organization.id);
    toast({
      title: t('platform:organization.brands.detached', {
        brand: pickLocalized(brand, 'name', locale),
      }),
      variant: 'success',
    });
  };

  const columns: DataTableColumn<Brand>[] = [
    {
      id: 'name',
      header: t('platform:tenants.name'),
      sortValue: (b) => pickLocalized(b, 'name', locale),
      cell: (b) => (
        <>
          <Link className="font-medium underline-offset-4 hover:underline" to={`/tenants/${b.id}`}>
            {pickLocalized(b, 'name', locale)}
          </Link>
          <span dir="ltr" className="block font-mono text-xs text-muted-foreground">
            {b.slug}
          </span>
        </>
      ),
    },
    {
      id: 'status',
      header: t('platform:tenants.status'),
      cell: (b) => <TenantStatusBadge status={b.status} />,
    },
    ...(manage
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">{t('platform:organization.brands.detach')}</span>,
            align: 'end' as const,
            cell: (b: Brand) => (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${t('platform:organization.brands.detach')}: ${pickLocalized(b, 'name', locale)}`}
                onClick={() => {
                  setDetaching(b);
                }}
              >
                <Unlink aria-hidden />
                {t('platform:organization.brands.detach')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-4">
      {manage ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setAttaching(true);
            }}
          >
            <Link2 aria-hidden />
            {t('platform:organization.brands.attach')}
          </Button>
          <Button
            onClick={() => {
              setProvisioning(true);
            }}
          >
            <Plus aria-hidden />
            {t('platform:organization.brands.provision')}
          </Button>
        </div>
      ) : null}
      <Card>
        <DataTable
          columns={columns}
          rows={organization.brands}
          rowKey={(b) => b.id}
          empty={t('platform:organization.brands.empty')}
        />
      </Card>
      {manage ? (
        <>
          <AttachBrandDialog
            organization={organization}
            open={attaching}
            onOpenChange={setAttaching}
          />
          <ProvisionDialog
            open={provisioning}
            onOpenChange={setProvisioning}
            organization={organization}
          />
          <AlertDialog
            open={detaching !== null}
            title={t('platform:organization.brands.detachTitle', {
              brand: detaching ? pickLocalized(detaching, 'name', locale) : '',
            })}
            description={t('platform:organization.brands.detachBody')}
            confirmLabel={t('platform:organization.brands.detach')}
            cancelLabel={t('common:actions.cancel')}
            destructive
            errorText={errorText}
            onConfirm={() => (detaching ? onDetach(detaching) : undefined)}
            onOpenChange={(open) => {
              if (!open) setDetaching(null);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
