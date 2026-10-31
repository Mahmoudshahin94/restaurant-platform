import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { BusinessType, TenantStatus, enumValues } from '@pos/shared-types';
import {
  Button,
  Card,
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
} from '@pos/ui';
import type { PlatformTenantsQuery } from '@pos/validation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Pagination } from '../components/pagination';
import { TenantStatusBadge } from '../components/status-badge';
import { api } from '../lib/api';
import { useDateTime } from '../lib/format';
import { usePlatformCan } from '../lib/permissions';
import { ProvisionDialog } from './provision-dialog';

const PAGE_SIZE = 25;

/** Every business on the platform: search, filters and provisioning. */
export function TenantsPage() {
  const { t } = useTranslation(['platform', 'admin', 'common']);
  const locale = useCurrentLocale();
  const formatDate = useDateTime();
  const can = usePlatformCan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [page, setPage] = useState(1);
  const [provisioning, setProvisioning] = useState(false);

  const query: PlatformTenantsQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status ? { status: status as TenantStatus } : {}),
    ...(businessType ? { businessType: businessType as BusinessType } : {}),
    ...(organizationId ? { organizationId } : {}),
  };
  const tenants = useQuery({
    queryKey: ['tenants', query],
    queryFn: () => api.tenants.list(query),
    placeholderData: keepPreviousData,
  });

  const organizations = useQuery({
    queryKey: ['organizations', 'options'],
    queryFn: () => api.organizations.list({ pageSize: 100 }),
  });

  return (
    <div>
      <PageHeader
        title={t('platform:tenants.title')}
        description={t('platform:tenants.description')}
        actions={
          can('tenants.provision') ? (
            <Button
              onClick={() => {
                setProvisioning(true);
              }}
            >
              <Plus aria-hidden />
              {t('platform:tenants.provision')}
            </Button>
          ) : null
        }
      />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('common:actions.search')}>
          <Input
            type="search"
            value={search}
            placeholder={t('platform:tenants.searchPlaceholder')}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={t('platform:tenants.status')}>
          <NativeSelect
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('platform:shared.any')}</option>
            {enumValues(TenantStatus).map((s) => (
              <option key={s} value={s}>
                {t(`platform:statuses.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('platform:tenants.businessType')}>
          <NativeSelect
            value={businessType}
            onChange={(e) => {
              setBusinessType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('platform:shared.any')}</option>
            {enumValues(BusinessType).map((b) => (
              <option key={b} value={b}>
                {t(`admin:tenant.businessTypes.${b}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('platform:tenants.organization')}>
          <NativeSelect
            value={organizationId}
            onChange={(e) => {
              setOrganizationId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('platform:shared.any')}</option>
            {(organizations.data?.items ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {pickLocalized(o, 'name', locale)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </Card>
      <QueryState
        query={tenants}
        isEmpty={(data) => data.items.length === 0}
        empty={{ title: t('platform:tenants.empty') }}
      >
        {(data) => (
          <>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('platform:tenants.name')}</TableHead>
                    <TableHead>{t('platform:tenants.status')}</TableHead>
                    <TableHead>{t('platform:tenants.businessType')}</TableHead>
                    <TableHead>{t('platform:tenants.organization')}</TableHead>
                    <TableHead>{t('platform:tenants.locations')}</TableHead>
                    <TableHead>{t('platform:tenants.users')}</TableHead>
                    <TableHead>{t('platform:tenants.domain')}</TableHead>
                    <TableHead>{t('platform:tenants.created')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((tenant) => (
                    <TableRow key={tenant.id}>
                      <TableCell>
                        <Link
                          className="font-medium underline-offset-4 hover:underline"
                          to={`/tenants/${tenant.id}`}
                        >
                          {pickLocalized(tenant, 'name', locale)}
                        </Link>
                        <span dir="ltr" className="block font-mono text-xs text-muted-foreground">
                          {tenant.slug}
                        </span>
                      </TableCell>
                      <TableCell>
                        <TenantStatusBadge status={tenant.status} />
                      </TableCell>
                      <TableCell>
                        {t(`admin:tenant.businessTypes.${tenant.businessType}`)}
                      </TableCell>
                      <TableCell>
                        {tenant.organization ? (
                          <Link
                            className="underline-offset-4 hover:underline"
                            to={`/organizations/${tenant.organization.id}`}
                          >
                            {pickLocalized(tenant.organization, 'name', locale)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="ltr-nums">{tenant.locationCount}</TableCell>
                      <TableCell className="ltr-nums">{tenant.userCount}</TableCell>
                      <TableCell dir="ltr" className="text-start font-mono text-xs">
                        {tenant.primaryDomain ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(tenant.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={setPage}
            />
          </>
        )}
      </QueryState>
      <ProvisionDialog open={provisioning} onOpenChange={setProvisioning} />
    </div>
  );
}
