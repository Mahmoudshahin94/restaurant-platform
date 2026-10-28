import { QueryState } from '@pos/app-kit';
import type { PlatformAuditEntry, PlatformAuditQuery } from '@pos/validation';
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AuditDetails } from '../components/audit-details';
import { Pagination } from '../components/pagination';
import { api } from '../lib/api';
import { useDateTime } from '../lib/format';

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z_.]{1,80}$/;

function Entry({ entry }: { entry: PlatformAuditEntry }) {
  const { t } = useTranslation('platform');
  const formatDate = useDateTime();
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <TableRow>
        <TableCell className="whitespace-nowrap">{formatDate(entry.createdAt)}</TableCell>
        <TableCell dir="ltr" className="text-start font-mono text-xs">
          {entry.action}
        </TableCell>
        <TableCell>
          <span className="text-xs">{entry.entityType}</span>
          {entry.entityId ? (
            <span dir="ltr" className="block font-mono text-[10px] text-muted-foreground">
              {entry.entityId}
            </span>
          ) : null}
        </TableCell>
        <TableCell>{entry.actorName ?? '—'}</TableCell>
        <TableCell>
          {entry.tenantId ? (
            <Link
              dir="ltr"
              className="font-mono text-[10px] underline-offset-4 hover:underline"
              to={`/tenants/${entry.tenantId}`}
            >
              {entry.tenantId}
            </Link>
          ) : (
            '—'
          )}
        </TableCell>
        <TableCell className="text-end">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            {t('audit.show')}
          </Button>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={6}>
            <AuditDetails metadata={entry.metadata} />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

/** What platform operators did, with their reasons, before and after. */
export function AuditPage() {
  const { t } = useTranslation('platform');
  const [tenantId, setTenantId] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const query: PlatformAuditQuery = {
    page,
    pageSize: PAGE_SIZE,
    ...(UUID.test(tenantId.trim()) ? { tenantId: tenantId.trim() } : {}),
    ...(ACTION.test(action.trim()) ? { action: action.trim() } : {}),
  };
  const entries = useQuery({
    queryKey: ['platform-audit', query],
    queryFn: () => api.auditLogs(query),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <Field label={t('audit.tenant')}>
          <Input
            dir="ltr"
            value={tenantId}
            placeholder={t('audit.tenantPlaceholder')}
            onChange={(e) => {
              setTenantId(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label={t('audit.action')} hint={t('audit.actionHint')}>
          <Input
            dir="ltr"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </Card>
      <QueryState
        query={entries}
        isEmpty={(d) => d.items.length === 0}
        empty={{ title: t('audit.empty') }}
      >
        {(data) => (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('audit.when')}</TableHead>
                    <TableHead>{t('audit.action')}</TableHead>
                    <TableHead>{t('audit.entity')}</TableHead>
                    <TableHead>{t('audit.actor')}</TableHead>
                    <TableHead>{t('audit.tenant')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((entry) => (
                    <Entry key={entry.id} entry={entry} />
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
    </div>
  );
}
