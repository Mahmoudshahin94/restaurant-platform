import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { Feature, FeatureSetting } from '@pos/shared-types';
import { Alert, Badge, Button, Card, CardContent, Field, NativeSelect, PageHeader } from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { keys, useAdminMutation, useLocations, useTenantId } from '../../lib/queries';

const TENANT_SCOPE = 'tenant';
type Choice = 'inherit' | 'on' | 'off';

const choiceOf = (setting: FeatureSetting): Choice =>
  setting.override === null ? 'inherit' : setting.override ? 'on' : 'off';

/**
 * The tenant's modules (ADR 0018), for the whole business or one location. Only modules the
 * tenant's plan includes and lets it switch are listed; each shows what it inherits and from
 * which layer, and can follow that, or be switched on or off for the scope.
 */
export function ModulesPage() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const errorText = useAdminErrorText();
  const tid = useTenantId();
  const locations = useLocations();
  const [scope, setScope] = useState(TENANT_SCOPE);
  const locationId = scope === TENANT_SCOPE ? null : scope;
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: keys.features(tid, locationId),
    queryFn: () => api.features.list(tid, locationId ? { locationId } : {}),
  });
  const save = useAdminMutation(
    (v: { feature: Feature; enabled: boolean | null }) =>
      api.features.set(tid, v.feature, { locationId, enabled: v.enabled }),
    // The apps' own view of modules, and the admin's navigation, follow at once.
    ['features', 'tenant-context'],
  );

  const choose = (feature: Feature, choice: Choice) => {
    setError(null);
    save.mutate(
      { feature, enabled: choice === 'inherit' ? null : choice === 'on' },
      {
        onError: (e) => {
          setError(errorText(e));
        },
      },
    );
  };
  const onOff = (enabled: boolean) => (enabled ? t('admin:modules.on') : t('admin:modules.off'));

  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader title={t('admin:modules.title')} description={t('admin:modules.description')} />
      <Field label={t('admin:modules.scope')}>
        <NativeSelect
          className="sm:max-w-sm"
          value={scope}
          onChange={(e) => {
            setError(null);
            setScope(e.target.value);
          }}
        >
          <option value={TENANT_SCOPE}>{t('admin:modules.scopeTenant')}</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {t('admin:modules.scopeLocation', { name: pickLocalized(l, 'name', locale) })}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <QueryState
        query={settings}
        isEmpty={(rows) => !rows.some((r) => r.entitled && r.configurable)}
        empty={{ title: t('admin:modules.empty') }}
      >
        {(rows) => (
          <Card>
            <CardContent className="divide-y p-0">
              {rows
                .filter((row) => row.entitled && row.configurable)
                .map((row) => {
                  const name = t(`admin:modules.features.${row.feature}.name`);
                  const current = choiceOf(row);
                  const choices: [Choice, string][] = [
                    [
                      'inherit',
                      t('admin:modules.inherit', { value: onOff(row.inherited.enabled) }),
                    ],
                    ['on', t('admin:modules.on')],
                    ['off', t('admin:modules.off')],
                  ];
                  return (
                    <section
                      key={row.feature}
                      aria-label={name}
                      className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-medium">{name}</h2>
                          <Badge variant={row.enabled ? 'success' : 'outline'}>
                            {row.enabled ? t('admin:modules.enabled') : t('admin:modules.disabled')}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {t(`admin:modules.features.${row.feature}.description`)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('admin:modules.source', {
                            source: t(`admin:modules.layers.${row.source}`),
                          })}
                        </p>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={t('admin:modules.choice', { module: name })}
                        className="flex flex-wrap gap-1"
                      >
                        {choices.map(([choice, label]) => (
                          <Button
                            key={choice}
                            role="radio"
                            size="sm"
                            aria-checked={current === choice}
                            variant={current === choice ? 'default' : 'outline'}
                            disabled={save.isPending}
                            onClick={() => {
                              if (choice !== current) choose(row.feature, choice);
                            }}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </section>
                  );
                })}
            </CardContent>
          </Card>
        )}
      </QueryState>
      <p className="text-xs text-muted-foreground">{t('admin:modules.hiddenNote')}</p>
    </div>
  );
}
