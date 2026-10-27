import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { PaymentProviderMethod, PaymentProviderMode } from '@pos/shared-types';
import type {
  EffectiveProvider,
  PaymentProviderAccount,
  PaymentProvidersOverview,
  ProviderCatalogEntry,
} from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { type SyntheticEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useDateTime } from '../../lib/format';
import { usePermissions } from '../../lib/permissions';
import { keys, useAdminMutation, useLocations, useTenantId } from '../../lib/queries';

/** Saving an account changes tenders too (a new one may be created and linked). */
const AFFECTS = ['payment-providers', 'payment-methods'];
type Location = { id: string; nameEn: string; nameAr: string };

/** The test-mode badge: never mistaken for money moving. */
export function ModeBadge({ mode }: { mode: PaymentProviderMode }) {
  const { t } = useTranslation('admin');
  return mode === 'TEST' ? (
    <Badge variant="warning" className="whitespace-nowrap">
      {t('paymentProviders.modes.TEST')}
    </Badge>
  ) : (
    <Badge variant="success" className="whitespace-nowrap">
      {t('paymentProviders.modes.LIVE')}
    </Badge>
  );
}

function SecretStatus({ account }: { account: PaymentProviderAccount }) {
  const { t } = useTranslation('admin');
  const dateTime = useDateTime();
  const { secret } = account;
  if (!secret.hasSecret) {
    return <span className="text-muted-foreground">{t('paymentProviders.secret.none')}</span>;
  }
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1">
        <KeyRound aria-hidden className="size-3.5" />
        {t('paymentProviders.secret.stored')}
      </span>
      <span className="text-xs text-muted-foreground">
        <span dir="ltr" className="font-mono">
          {secret.fingerprint}
        </span>
        {secret.updatedAt
          ? ` · ${t('paymentProviders.secret.updated', { at: dateTime(secret.updatedAt) })}`
          : null}
      </span>
    </span>
  );
}

interface FormState {
  method: PaymentProviderMethod;
  providerKey: string;
  locationId: string;
  mode: PaymentProviderMode;
  active: boolean;
  publicConfig: Record<string, string>;
  secrets: Record<string, string>;
}

function initialForm(
  account: PaymentProviderAccount | null,
  catalog: ProviderCatalogEntry[],
): FormState {
  const first = catalog[0];
  const providerKey = account?.providerKey ?? first?.key ?? '';
  const entry = catalog.find((c) => c.key === providerKey);
  return {
    method: account?.method ?? first?.method ?? 'ONLINE',
    providerKey,
    locationId: account?.locationId ?? '',
    mode: account?.mode ?? entry?.modes[0] ?? 'TEST',
    active: account ? account.status === 'ACTIVE' : true,
    publicConfig: Object.fromEntries(
      Object.entries(account?.publicConfig ?? {}).map(([k, v]) => [k, String(v)]),
    ),
    // Secrets are never shown again: the fields always start empty.
    secrets: {},
  };
}

function AccountDialog({
  account,
  catalog,
  locations,
  onClose,
}: {
  account: PaymentProviderAccount | null;
  catalog: ProviderCatalogEntry[];
  locations: Location[];
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const formId = useId();
  const [form, setForm] = useState<FormState>(() => initialForm(account, catalog));
  const [formError, setFormError] = useState<string | null>(null);
  const methods = [...new Set(catalog.map((c) => c.method))];
  const providers = catalog.filter((c) => c.method === form.method);
  const entry = catalog.find((c) => c.key === form.providerKey) ?? null;
  const set = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };
  const pickProvider = (key: string) => {
    const next = catalog.find((c) => c.key === key);
    set({ providerKey: key, mode: next?.modes[0] ?? 'TEST', publicConfig: {}, secrets: {} });
  };
  const save = useAdminMutation(async (state: FormState) => {
    const publicConfig = Object.fromEntries(
      Object.entries(state.publicConfig).filter(([, v]) => v.trim().length > 0),
    );
    const secrets = Object.fromEntries(
      Object.entries(state.secrets).filter(([, v]) => v.trim().length > 0),
    );
    const status = state.active ? ('ACTIVE' as const) : ('DISABLED' as const);
    return account
      ? api.admin.paymentProviders.update(tid, account.id, {
          mode: state.mode,
          publicConfig,
          status,
          ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
        })
      : api.admin.paymentProviders.create(tid, {
          method: state.method,
          providerKey: state.providerKey,
          locationId: state.locationId || null,
          mode: state.mode,
          publicConfig,
          status,
          ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
        });
  }, AFFECTS);
  const onSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      await save.mutateAsync(form);
      onClose();
    } catch (error) {
      setFormError(errorText(error));
    }
  };
  const fieldLabel = (name: string) => t(`admin:paymentProviders.fields.${name}`, name);

  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>
          {account ? t('admin:paymentProviders.edit') : t('admin:paymentProviders.new')}
        </DialogTitle>
      </DialogHeader>
      <form id={formId} className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <Field label={t('admin:paymentProviders.method')}>
          <NativeSelect
            disabled={account !== null}
            value={form.method}
            onChange={(e) => {
              const method = e.target.value as PaymentProviderMethod;
              const next = catalog.find((c) => c.method === method);
              set({
                method,
                providerKey: next?.key ?? '',
                mode: next?.modes[0] ?? 'TEST',
                publicConfig: {},
                secrets: {},
              });
            }}
          >
            {methods.map((method) => (
              <option key={method} value={method}>
                {t(`admin:paymentProviders.methods.${method}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label={t('admin:paymentProviders.provider')}
          hint={account ? t('admin:paymentProviders.providerFixed') : undefined}
        >
          <NativeSelect
            disabled={account !== null}
            value={form.providerKey}
            onChange={(e) => {
              pickProvider(e.target.value);
            }}
          >
            {providers.map((p) => (
              <option key={p.key} value={p.key}>
                {t(`admin:paymentProviders.providers.${p.key}`, p.key)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label={t('admin:paymentProviders.appliesTo')}
          hint={t('admin:paymentProviders.appliesToHint')}
        >
          <NativeSelect
            disabled={account !== null}
            value={form.locationId}
            onChange={(e) => {
              set({ locationId: e.target.value });
            }}
          >
            <option value="">{t('admin:paymentProviders.wholeBusiness')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {pickLocalized(l, 'name', locale)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('admin:paymentProviders.mode')} hint={t('admin:paymentProviders.modeHint')}>
          <NativeSelect
            value={form.mode}
            onChange={(e) => {
              set({ mode: e.target.value as PaymentProviderMode });
            }}
          >
            {(entry?.modes ?? []).map((mode) => (
              <option key={mode} value={mode}>
                {t(`admin:paymentProviders.modes.${mode}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {entry?.publicFields.map((field) => (
          <Field key={field.name} label={fieldLabel(field.name)}>
            <Input
              dir="ltr"
              value={form.publicConfig[field.name] ?? ''}
              required={field.required}
              onChange={(e) => {
                set({ publicConfig: { ...form.publicConfig, [field.name]: e.target.value } });
              }}
            />
          </Field>
        ))}
        {entry && entry.secretFields.length > 0 ? (
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {t('admin:paymentProviders.secret.title')}
            </legend>
            <p className="text-sm text-muted-foreground">
              {account?.secret.hasSecret
                ? t('admin:paymentProviders.secret.replaceHint')
                : t('admin:paymentProviders.secret.writeOnlyHint')}
            </p>
            {entry.secretFields.map((field) => (
              <Field key={field.name} label={fieldLabel(field.name)} hint={field.hint}>
                <Input
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={
                    account?.secret.hasSecret ? t('admin:paymentProviders.secret.keep') : undefined
                  }
                  value={form.secrets[field.name] ?? ''}
                  onChange={(e) => {
                    set({ secrets: { ...form.secrets, [field.name]: e.target.value } });
                  }}
                />
              </Field>
            ))}
          </fieldset>
        ) : null}
        <label className="flex items-center justify-between gap-3">
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{t('admin:paymentProviders.enabled')}</span>
            <span className="text-sm text-muted-foreground">
              {t('admin:paymentProviders.enabledHint')}
            </span>
          </span>
          <Switch
            checked={form.active}
            onCheckedChange={(active) => {
              set({ active });
            }}
            aria-label={t('admin:paymentProviders.enabled')}
          />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending || !entry}>
            {save.isPending ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Which provider takes each method at each location, and the layer that decided it. */
function EffectiveTable({
  effective,
  locations,
}: {
  effective: EffectiveProvider[];
  locations: Location[];
}) {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const methods: PaymentProviderMethod[] = ['ONLINE', 'TERMINAL'];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('paymentProviders.effective.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('paymentProviders.effective.description')}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('shared.location')}</TableHead>
              {methods.map((m) => (
                <TableHead key={m}>{t(`paymentProviders.methods.${m}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {locations.map((location) => (
              <TableRow key={location.id}>
                <TableCell className="font-medium">
                  {pickLocalized(location, 'name', locale)}
                </TableCell>
                {methods.map((method) => {
                  const row = effective.find(
                    (e) => e.locationId === location.id && e.method === method,
                  );
                  return (
                    <TableCell key={method}>
                      {row?.providerKey ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {t(`paymentProviders.providers.${row.providerKey}`, row.providerKey)}
                          {row.mode ? <ModeBadge mode={row.mode} /> : null}
                          <span className="text-xs text-muted-foreground">
                            {t(`paymentProviders.sources.${row.source}`)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t(`paymentProviders.none.${method}`)}
                        </span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AccountsTable({
  overview,
  locations,
  canManage,
  onEdit,
}: {
  overview: PaymentProvidersOverview;
  locations: Location[];
  canManage: boolean;
  onEdit: (account: PaymentProviderAccount) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const placeOf = (id: string | null) => {
    const location = id ? locations.find((l) => l.id === id) : null;
    return location
      ? pickLocalized(location, 'name', locale)
      : t('admin:paymentProviders.wholeBusiness');
  };
  if (overview.accounts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t('admin:paymentProviders.empty')}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin:paymentProviders.method')}</TableHead>
            <TableHead>{t('admin:paymentProviders.provider')}</TableHead>
            <TableHead>{t('admin:paymentProviders.appliesTo')}</TableHead>
            <TableHead>{t('admin:paymentProviders.mode')}</TableHead>
            <TableHead>{t('admin:paymentProviders.secret.title')}</TableHead>
            <TableHead>{t('admin:shared.status')}</TableHead>
            <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {overview.accounts.map((account) => (
            <TableRow key={account.id}>
              <TableCell>{t(`admin:paymentProviders.methods.${account.method}`)}</TableCell>
              <TableCell className="font-medium">
                {t(`admin:paymentProviders.providers.${account.providerKey}`, account.providerKey)}
              </TableCell>
              <TableCell>{placeOf(account.locationId)}</TableCell>
              <TableCell>
                <ModeBadge mode={account.mode} />
              </TableCell>
              <TableCell>
                <SecretStatus account={account} />
              </TableCell>
              <TableCell>
                {account.status === 'ACTIVE' ? (
                  <Badge variant="success">{t('admin:paymentProviders.status.ACTIVE')}</Badge>
                ) : (
                  <Badge variant="secondary">{t('admin:paymentProviders.status.DISABLED')}</Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('admin:paymentProviders.editNamed', {
                        name: t(
                          `admin:paymentProviders.providers.${account.providerKey}`,
                          account.providerKey,
                        ),
                      })}
                      onClick={() => {
                        onEdit(account);
                      }}
                    >
                      <Pencil aria-hidden />
                      {t('common:actions.edit')}
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/**
 * Settings → Payment providers (ADR 0024): which provider takes online card checkout and kiosk
 * card readers, for the whole business or one location, in test or live mode. Secrets are typed
 * once and never shown again: the page shows only whether one is stored and its fingerprint.
 */
export function PaymentProvidersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const { can } = usePermissions();
  const canManage = can('settings.manage');
  const [editing, setEditing] = useState<PaymentProviderAccount | 'new' | null>(null);
  const query = useQuery({
    queryKey: keys.paymentProviders(tid),
    queryFn: () => api.admin.paymentProviders.overview(tid),
  });
  const locationsQuery = useLocations();
  const locations: Location[] = (locationsQuery.data ?? []).filter(
    (l) => (l as { isActive?: boolean }).isActive !== false,
  );
  const configurable = (query.data?.catalog ?? []).filter((c) => !c.builtIn);

  return (
    <>
      <PageHeader
        title={t('admin:paymentProviders.title')}
        description={t('admin:paymentProviders.description')}
        actions={
          canManage && configurable.length > 0 ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('admin:paymentProviders.new')}
            </Button>
          ) : null
        }
      />
      <QueryState query={query}>
        {(overview) => (
          <div className="grid gap-6">
            <Alert>{t('admin:paymentProviders.builtIn')}</Alert>
            <AccountsTable
              overview={overview}
              locations={locations}
              canManage={canManage}
              onEdit={setEditing}
            />
            <EffectiveTable effective={overview.effective} locations={locations} />
          </div>
        )}
      </QueryState>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null ? (
          <AccountDialog
            key={editing === 'new' ? 'new' : editing.id}
            account={editing === 'new' ? null : editing}
            catalog={configurable}
            locations={locations}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
