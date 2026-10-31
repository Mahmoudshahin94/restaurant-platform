import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { OrganizationStatus, enumValues } from '@pos/shared-types';
import {
  Button,
  Card,
  DataTable,
  type DataTableColumn,
  Field,
  Input,
  NativeSelect,
  PageHeader,
} from '@pos/ui';
import type { PlatformOrganizationSummary, PlatformOrganizationsQuery } from '@pos/validation';
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
import { CreateOrganizationDialog } from './organization/create-organization-dialog';

const PAGE_SIZE = 25;

/** Every organization: search, status filter and creation (E1, spec section 6). */
export function OrganizationsPage() {
  const { t } = useTranslation(['platform', 'common']);
  const locale = useCurrentLocale();
  const formatDate = useDateTime();
  const can = usePlatformCan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const query: PlatformOrganizationsQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status ? { status: status as OrganizationStatus } : {}),
  };
  const organizations = useQuery({
    queryKey: ['organizations', query],
    queryFn: () => api.organizations.list(query),
    placeholderData: keepPreviousData,
  });

  const columns: DataTableColumn<PlatformOrganizationSummary>[] = [
    {
      id: 'name',
      header: t('platform:organizations.name'),
      sortValue: (o) => pickLocalized(o, 'name', locale),
      cell: (o) => (
        <>
          <Link
            className="font-medium underline-offset-4 hover:underline"
            to={`/organizations/${o.id}`}
          >
            {pickLocalized(o, 'name', locale)}
          </Link>
          <span dir="ltr" className="block font-mono text-xs text-muted-foreground">
            {o.slug}
          </span>
        </>
      ),
    },
    {
      id: 'status',
      header: t('platform:organizations.status'),
      cell: (o) => <TenantStatusBadge status={o.status} />,
    },
    {
      id: 'currency',
      header: t('platform:organizations.currency'),
      cell: (o) => <span dir="ltr">{o.currencyCode}</span>,
    },
    {
      id: 'brands',
      header: t('platform:organizations.brands'),
      align: 'end',
      sortValue: (o) => o.brandCount,
      cell: (o) => o.brandCount,
    },
    {
      id: 'members',
      header: t('platform:organizations.members'),
      align: 'end',
      sortValue: (o) => o.memberCount,
      cell: (o) => o.memberCount,
    },
    {
      id: 'created',
      header: t('platform:organizations.created'),
      sortValue: (o) => o.createdAt,
      cell: (o) => <span className="whitespace-nowrap">{formatDate(o.createdAt)}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('platform:organizations.title')}
        description={t('platform:organizations.description')}
        actions={
          can('organizations.manage') ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus aria-hidden />
              {t('platform:organizations.create')}
            </Button>
          ) : null
        }
      />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <Field label={t('common:actions.search')}>
          <Input
            type="search"
            value={search}
            placeholder={t('platform:organizations.searchPlaceholder')}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={t('platform:organizations.status')}>
          <NativeSelect
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('platform:shared.any')}</option>
            {enumValues(OrganizationStatus).map((s) => (
              <option key={s} value={s}>
                {t(`platform:statuses.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </Card>
      <QueryState
        query={organizations}
        isEmpty={(data) => data.items.length === 0}
        empty={{ title: t('platform:organizations.empty') }}
      >
        {(data) => (
          <>
            <Card>
              <DataTable columns={columns} rows={data.items} rowKey={(o) => o.id} />
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
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
