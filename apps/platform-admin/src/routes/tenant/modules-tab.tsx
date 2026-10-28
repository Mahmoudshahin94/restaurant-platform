import { QueryState } from '@pos/app-kit';
import type { Feature } from '@pos/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@pos/ui';
import type { PlatformModule, PlatformTenantDetail } from '@pos/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { usePlatformErrorText } from '../../lib/errors';
import { usePlatformCan } from '../../lib/permissions';

type Draft = Record<string, { entitled: boolean; tenantConfigurable: boolean }>;

const draftOf = (modules: readonly PlatformModule[]): Draft =>
  Object.fromEntries(
    modules.map((m) => [
      m.feature,
      { entitled: m.entitled, tenantConfigurable: m.tenantConfigurable },
    ]),
  );

function ModulesEditor({
  detail,
  modules,
}: {
  detail: PlatformTenantDetail;
  modules: PlatformModule[];
}) {
  const { t } = useTranslation(['platform', 'admin', 'common']);
  const errorText = usePlatformErrorText();
  const can = usePlatformCan();
  const queryClient = useQueryClient();
  const tenantId = detail.tenant.id;
  const editable = can('tenants.configure') && detail.tenant.status !== 'ARCHIVED';
  const [draft, setDraft] = useState<Draft>(() => draftOf(modules));
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.tenants.setEntitlements(tenantId, {
        reason,
        entitlements: modules.flatMap((m) => {
          const next = draft[m.feature];
          if (!next) return [];
          const changed =
            next.entitled !== m.entitled || next.tenantConfigurable !== m.tenantConfigurable;
          return changed ? [{ feature: m.feature, ...next }] : [];
        }),
      }),
  });
  const changed = modules.some(
    (m) =>
      draft[m.feature]?.entitled !== m.entitled ||
      draft[m.feature]?.tenantConfigurable !== m.tenantConfigurable,
  );

  const submit = async () => {
    setMessage(null);
    try {
      const updated = await save.mutateAsync();
      queryClient.setQueryData(['tenant', tenantId, 'modules'], updated);
      setDraft(draftOf(updated));
      setReason('');
      setMessage({ ok: true, text: t('platform:modules.saved') });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
  };

  const name = (f: Feature) => t(`admin:modules.features.${f}.name`);

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('platform:modules.description')}</p>
      {message ? <Alert variant={message.ok ? 'info' : 'destructive'}>{message.text}</Alert> : null}
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('platform:modules.module')}</TableHead>
              <TableHead>{t('platform:modules.entitled')}</TableHead>
              <TableHead>{t('platform:modules.configurable')}</TableHead>
              <TableHead>{t('platform:modules.default')}</TableHead>
              <TableHead>{t('platform:modules.enabled')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {modules.map((m) => {
              const value = draft[m.feature] ?? {
                entitled: m.entitled,
                tenantConfigurable: m.tenantConfigurable,
              };
              const update = (patch: Partial<typeof value>) => {
                setDraft((d) => ({ ...d, [m.feature]: { ...value, ...patch } }));
              };
              return (
                <TableRow key={m.feature}>
                  <TableCell>
                    {name(m.feature)}
                    <span className="block text-xs text-muted-foreground">
                      {m.explicit
                        ? t('platform:modules.explicit')
                        : t('platform:modules.inherited')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      aria-label={`${name(m.feature)}: ${t('platform:modules.entitled')}`}
                      checked={value.entitled}
                      disabled={!editable}
                      onCheckedChange={(checked) => {
                        update({ entitled: checked === true });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${name(m.feature)}: ${t('platform:modules.configurable')}`}
                      checked={value.tenantConfigurable}
                      disabled={!editable || !value.entitled}
                      onCheckedChange={(checked) => {
                        update({ tenantConfigurable: checked });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    {m.businessTypeDefault ? t('admin:modules.on') : t('admin:modules.off')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.enabled ? 'success' : 'secondary'}>
                      {m.enabled ? t('admin:modules.on') : t('admin:modules.off')}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      {editable ? (
        <Card className="grid gap-3 p-4">
          <Field label={t('platform:shared.reason')} hint={t('platform:shared.reasonHint')}>
            <Textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </Field>
          <div>
            <Button
              disabled={!changed || reason.trim().length < 5 || save.isPending}
              onClick={() => void submit()}
            >
              {save.isPending ? t('common:states.saving') : t('platform:modules.save')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function ModulesTab({ detail }: { detail: PlatformTenantDetail }) {
  const tenantId = detail.tenant.id;
  const modules = useQuery({
    queryKey: ['tenant', tenantId, 'modules'],
    queryFn: () => api.tenants.modules(tenantId),
  });
  return (
    <QueryState query={modules}>
      {(list) => <ModulesEditor key={JSON.stringify(list)} detail={detail} modules={list} />}
    </QueryState>
  );
}
