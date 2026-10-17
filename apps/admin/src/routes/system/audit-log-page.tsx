import { QueryState } from '@pos/app-kit';
import { ActionSource, enumValues } from '@pos/shared-types';
import type { AuditLogEntry, AuditLogQuery } from '@pos/validation';
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
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pagination } from '../../components/pagination';
import { api } from '../../lib/api';
import { useDateTime, useLocationLookup } from '../../lib/format';
import { keys, useRestaurantId } from '../../lib/queries';

const PAGE_SIZE = 50;
const EMPTY = {
  action: '',
  entityType: '',
  entityId: '',
  locationId: '',
  source: '',
  from: '',
  to: '',
};

function Entry({ entry }: { entry: AuditLogEntry }) {
  const { t } = useTranslation('admin');
  const formatDate = useDateTime();
  const { name } = useLocationLookup();
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <TableRow>
        <TableCell className="whitespace-nowrap">
          {formatDate(entry.createdAt, entry.locationId)}
        </TableCell>
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
          {entry.actorName ?? t(`actorTypes.${entry.actorType}`)}
          {entry.actorName ? (
            <span className="block text-xs text-muted-foreground">
              {t(`actorTypes.${entry.actorType}`)}
            </span>
          ) : null}
        </TableCell>
        <TableCell>{entry.source ? t(`sources.${entry.source}`) : ''}</TableCell>
        <TableCell>
          {entry.locationId ? name(entry.locationId) : t('audit.restaurantLevel')}
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
          <TableCell colSpan={7}>
            <pre
              dir="ltr"
              className="max-h-80 overflow-auto rounded bg-muted p-3 text-start text-xs"
            >
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
            {entry.requestId ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('audit.requestId')}: <span dir="ltr">{entry.requestId}</span>
              </p>
            ) : null}
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

export function AuditLogPage() {
  const { t } = useTranslation(['admin', 'common']);
  const rid = useRestaurantId();
  const { list, name } = useLocationLookup();
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const query: AuditLogQuery = {
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.trim() !== '')),
    page,
    pageSize: PAGE_SIZE,
  };
  const entries = useQuery({
    queryKey: keys.auditLogs(rid, query),
    queryFn: () => api.admin.auditLogs(rid, query),
    placeholderData: keepPreviousData,
  });
  const text = (key: keyof typeof EMPTY, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        dir="ltr"
        value={draft[key]}
        onChange={(e) => {
          setDraft((d) => ({ ...d, [key]: e.target.value }));
        }}
      />
    </Field>
  );
  return (
    <>
      <PageHeader title={t('admin:audit.title')} description={t('admin:audit.description')} />
      <Card className="mb-4 p-4">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters(draft);
            setPage(1);
          }}
        >
          {text('action', t('admin:audit.action'), t('admin:audit.actionHint'))}
          {text('entityType', t('admin:audit.entity'))}
          <Field label={t('admin:audit.location')}>
            <NativeSelect
              value={draft.locationId}
              onChange={(e) => {
                setDraft((d) => ({ ...d, locationId: e.target.value }));
              }}
            >
              <option value="">{t('admin:shared.allLocations')}</option>
              {list.map((l) => (
                <option key={l.id} value={l.id}>
                  {name(l.id)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin:audit.source')}>
            <NativeSelect
              value={draft.source}
              onChange={(e) => {
                setDraft((d) => ({ ...d, source: e.target.value }));
              }}
            >
              <option value="">{t('admin:shared.any')}</option>
              {enumValues(ActionSource).map((s) => (
                <option key={s} value={s}>
                  {t(`admin:sources.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin:shared.from')}>
            <Input
              type="date"
              dir="ltr"
              value={draft.from}
              onChange={(e) => {
                setDraft((d) => ({ ...d, from: e.target.value }));
              }}
            />
          </Field>
          <Field label={t('admin:shared.to')}>
            <Input
              type="date"
              dir="ltr"
              value={draft.to}
              onChange={(e) => {
                setDraft((d) => ({ ...d, to: e.target.value }));
              }}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit">{t('admin:shared.search')}</Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(EMPTY);
                setFilters(EMPTY);
                setPage(1);
              }}
            >
              {t('admin:shared.clear')}
            </Button>
          </div>
        </form>
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
                    <TableHead>{t('admin:audit.location')}</TableHead>
                    <TableHead className="text-end">{t('admin:audit.metadata')}</TableHead>
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
    </>
  );
}
