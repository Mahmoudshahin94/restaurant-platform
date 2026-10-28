import { QueryState } from '@pos/app-kit';
import type { AuditLogEntry } from '@pos/validation';
import {
  Button,
  Card,
  Field,
  Input,
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
import { AuditDetails } from '../../components/audit-details';
import { Pagination } from '../../components/pagination';
import { api } from '../../lib/api';
import { useDateTime } from '../../lib/format';

const PAGE_SIZE = 50;

function Entry({ entry }: { entry: AuditLogEntry }) {
  const { t } = useTranslation(['admin', 'platform']);
  const formatDate = useDateTime();
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <TableRow data-testid="tenant-audit-entry">
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
        <TableCell>
          {entry.actorName ?? t(`admin:actorTypes.${entry.actorType}`)}
          {entry.actorName ? (
            <span className="block text-xs text-muted-foreground">
              {t(`admin:actorTypes.${entry.actorType}`)}
            </span>
          ) : null}
        </TableCell>
        <TableCell>{entry.source ? t(`admin:sources.${entry.source}`) : ''}</TableCell>
        <TableCell className="text-end">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            {t('admin:audit.show')}
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

/** The business's own audit log, as its administrators see it (platform actions included). */
export function AuditTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation(['admin', 'platform']);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE, ...(action.trim() ? { action: action.trim() } : {}) };
  const entries = useQuery({
    queryKey: ['tenant', tenantId, 'audit', query],
    queryFn: () => api.tenants.auditLogs(tenantId, query),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="grid gap-4">
      <Card className="p-4">
        <Field label={t('admin:audit.action')} hint={t('admin:audit.actionHint')}>
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
        empty={{ title: t('admin:audit.empty') }}
      >
        {(data) => (
          <>
            <Card className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin:audit.when')}</TableHead>
                    <TableHead>{t('admin:audit.action')}</TableHead>
                    <TableHead>{t('admin:audit.entity')}</TableHead>
                    <TableHead>{t('admin:audit.actor')}</TableHead>
                    <TableHead>{t('admin:audit.source')}</TableHead>
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
