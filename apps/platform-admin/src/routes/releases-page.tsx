import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { DeviceVersionStatus, ReleaseChannel } from '@pos/shared-types';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  Textarea,
} from '@pos/ui';
import type { ReleaseDto, ReleasesOverview, TenantDeviceVersions } from '@pos/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { usePlatformErrorText } from '../lib/errors';
import { useDateTime } from '../lib/format';
import { usePlatformCan } from '../lib/permissions';

const CHANNELS: ReleaseChannel[] = ['STABLE', 'BETA'];
const MIN_REASON = 5;

const STATUS_VARIANT: Record<
  DeviceVersionStatus,
  'success' | 'warning' | 'destructive' | 'secondary'
> = {
  CURRENT: 'success',
  OUTDATED: 'warning',
  UNSUPPORTED: 'destructive',
  UNKNOWN: 'secondary',
};

/** Every query this page's changes affect. */
const RELEASE_QUERIES = ['releases', 'device-versions', 'health-board'];

function Version({ value }: { value: string | null }) {
  const { t } = useTranslation('platform');
  return value ? (
    <span dir="ltr" className="whitespace-nowrap font-mono text-xs">
      {value}
    </span>
  ) : (
    <span className="text-muted-foreground">{t('releases.none')}</span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Publishes a release, or corrects one (its channel, minimums and notes; never its version). */
function ReleaseDialog({ release }: { release?: ReleaseDto }) {
  const { t } = useTranslation(['platform', 'common']);
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const blank: {
    version: string;
    channel: ReleaseChannel;
    minHub: string;
    minClient: string;
    notes: string;
  } = {
    version: release?.version ?? '',
    channel: release?.channel ?? 'STABLE',
    minHub: release?.minSupportedHubVersion ?? '',
    minClient: release?.minSupportedClientVersion ?? '',
    notes: release?.notes ?? '',
  };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const minimums = {
        minSupportedHubVersion: form.minHub.trim() || null,
        minSupportedClientVersion: form.minClient.trim() || null,
      };
      return release
        ? api.releases.update(release.id, { channel: form.channel, notes: form.notes, ...minimums })
        : api.releases.publish({
            version: form.version.trim(),
            channel: form.channel,
            notes: form.notes,
            ...minimums,
          });
    },
  });
  const submit = async () => {
    setError(null);
    try {
      await save.mutateAsync();
      await Promise.all(
        RELEASE_QUERIES.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const set = (key: Exclude<keyof typeof form, 'channel'>) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };
  // Every opening starts from the release as published (or an empty form), never the last one.
  const show = (next: boolean) => {
    if (next) setForm(blank);
    setError(null);
    setOpen(next);
  };
  return (
    <Dialog open={open} onOpenChange={show}>
      <Button
        variant={release ? 'outline' : 'default'}
        size={release ? 'sm' : 'default'}
        onClick={() => {
          show(true);
        }}
      >
        {release ? t('common:actions.edit') : t('platform:releases.publish')}
      </Button>
      <DialogContent closeLabel={t('common:actions.close')}>
        <DialogHeader>
          <DialogTitle>
            {release
              ? t('platform:releases.editTitle', { version: release.version })
              : t('platform:releases.publishTitle')}
          </DialogTitle>
          <DialogDescription>{t('platform:releases.publishDescription')}</DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {release ? null : (
          <Field label={t('platform:releases.version')} hint={t('platform:releases.versionHint')}>
            <Input
              dir="ltr"
              value={form.version}
              onChange={(e) => {
                set('version')(e.target.value);
              }}
            />
          </Field>
        )}
        <Field label={t('platform:releases.channel')}>
          <NativeSelect
            value={form.channel}
            onChange={(e) => {
              const channel = e.target.value as ReleaseChannel;
              setForm((f) => ({ ...f, channel }));
            }}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`platform:releases.channels.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('platform:releases.minHub')} hint={t('platform:releases.minHint')}>
          <Input
            dir="ltr"
            value={form.minHub}
            onChange={(e) => {
              set('minHub')(e.target.value);
            }}
          />
        </Field>
        <Field label={t('platform:releases.minClient')} hint={t('platform:releases.minHint')}>
          <Input
            dir="ltr"
            value={form.minClient}
            onChange={(e) => {
              set('minClient')(e.target.value);
            }}
          />
        </Field>
        <Field label={t('platform:releases.notes')}>
          <Textarea
            value={form.notes}
            onChange={(e) => {
              set('notes')(e.target.value);
            }}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            disabled={(!release && form.version.trim() === '') || save.isPending}
            onClick={() => void submit()}
          >
            {release ? t('common:actions.save') : t('platform:releases.publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Puts a tenant on a channel or pins it to a published version, with a reason (audited). */
function RolloutDialog({
  tenant,
  releases,
}: {
  tenant: TenantDeviceVersions;
  releases: ReleaseDto[];
}) {
  const { t } = useTranslation(['platform', 'common']);
  const locale = useCurrentLocale();
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<ReleaseChannel>(tenant.channel);
  const [pinned, setPinned] = useState(tenant.pinnedVersion ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () =>
      api.releases.setRollout(tenant.tenantId, {
        channel,
        pinnedVersion: pinned === '' ? null : pinned,
        reason,
      }),
  });
  const submit = async () => {
    setError(null);
    try {
      await change.mutateAsync();
      await Promise.all(
        RELEASE_QUERIES.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
      setOpen(false);
      setReason('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  // Every opening starts from the tenant's current setting.
  const show = (next: boolean) => {
    if (next) {
      setChannel(tenant.channel);
      setPinned(tenant.pinnedVersion ?? '');
      setReason('');
    }
    setError(null);
    setOpen(next);
  };
  return (
    <Dialog open={open} onOpenChange={show}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          show(true);
        }}
      >
        {t('platform:releases.changeChannel')}
      </Button>
      <DialogContent closeLabel={t('common:actions.close')}>
        <DialogHeader>
          <DialogTitle>
            {t('platform:releases.rolloutTitle', { name: pickLocalized(tenant, 'name', locale) })}
          </DialogTitle>
          <DialogDescription>{t('platform:releases.rolloutDescription')}</DialogDescription>
        </DialogHeader>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <Field label={t('platform:releases.channel')}>
          <NativeSelect
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value as ReleaseChannel);
            }}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {t(`platform:releases.channels.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('platform:releases.pinnedVersion')} hint={t('platform:releases.pinHint')}>
          <NativeSelect
            value={pinned}
            onChange={(e) => {
              setPinned(e.target.value);
            }}
          >
            <option value="">{t('platform:releases.followChannel')}</option>
            {releases.map((r) => (
              <option key={r.id} value={r.version}>
                {r.version}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('platform:shared.reason')} hint={t('platform:shared.reasonHint')}>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </Field>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            disabled={reason.trim().length < MIN_REASON || change.isPending}
            onClick={() => void submit()}
          >
            {t('common:actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleasesTable({ data }: { data: ReleasesOverview }) {
  const { t } = useTranslation(['platform', 'common']);
  const formatDate = useDateTime();
  const can = usePlatformCan();
  if (data.releases.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('platform:releases.noReleases')}</p>;
  }
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('platform:releases.version')}</TableHead>
            <TableHead>{t('platform:releases.channel')}</TableHead>
            <TableHead>{t('platform:releases.publishedAt')}</TableHead>
            <TableHead>{t('platform:releases.minHub')}</TableHead>
            <TableHead>{t('platform:releases.minClient')}</TableHead>
            <TableHead>{t('platform:releases.notes')}</TableHead>
            {can('releases.publish') ? (
              <TableHead>
                <span className="sr-only">{t('common:actions.edit')}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.releases.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Version value={r.version} />
              </TableCell>
              <TableCell>
                <Badge variant={r.channel === 'STABLE' ? 'success' : 'warning'}>
                  {t(`platform:releases.channels.${r.channel}`)}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDate(r.publishedAt)}
                {r.publishedByName ? (
                  <span className="block text-xs text-muted-foreground">{r.publishedByName}</span>
                ) : null}
              </TableCell>
              <TableCell>
                <Version value={r.minSupportedHubVersion} />
              </TableCell>
              <TableCell>
                <Version value={r.minSupportedClientVersion} />
              </TableCell>
              <TableCell className="min-w-48 max-w-sm whitespace-pre-line text-sm" dir="auto">
                {r.notes}
              </TableCell>
              {can('releases.publish') ? (
                <TableCell>
                  <ReleaseDialog release={r} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function TenantVersions({
  tenant,
  releases,
}: {
  tenant: TenantDeviceVersions;
  releases: ReleaseDto[];
}) {
  const { t } = useTranslation(['platform', 'admin']);
  const locale = useCurrentLocale();
  const formatDate = useDateTime();
  const can = usePlatformCan();
  return (
    <Card data-testid={`versions-${tenant.slug}`}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle>
            <Link
              className="underline-offset-4 hover:underline"
              to={`/tenants/${tenant.tenantId}/devices`}
            >
              {pickLocalized(tenant, 'name', locale)}
            </Link>
          </CardTitle>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={tenant.channel === 'STABLE' ? 'success' : 'warning'}>
              {t(`platform:releases.channels.${tenant.channel}`)}
            </Badge>
            {tenant.pinnedVersion ? (
              <Badge variant="secondary">
                {t('platform:releases.pinnedTo', { version: tenant.pinnedVersion })}
              </Badge>
            ) : null}
            <span>
              {t('platform:releases.target')}: <Version value={tenant.targetVersion} />
            </span>
            {tenant.unsupported > 0 ? (
              <Badge variant="destructive">
                {t('platform:releases.unsupportedCount', { count: tenant.unsupported })}
              </Badge>
            ) : null}
            {tenant.outdated > 0 ? (
              <Badge variant="warning">
                {t('platform:releases.outdatedCount', { count: tenant.outdated })}
              </Badge>
            ) : null}
          </p>
        </div>
        {can('releases.rollout') ? <RolloutDialog tenant={tenant} releases={releases} /> : null}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {tenant.devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('platform:releases.noDevices')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('platform:releases.location')}</TableHead>
                <TableHead>{t('platform:releases.device')}</TableHead>
                <TableHead>{t('platform:releases.version')}</TableHead>
                <TableHead>{t('platform:releases.since')}</TableHead>
                <TableHead>{t('platform:releases.versionStatus')}</TableHead>
                <TableHead>{t('platform:releases.lastSeen')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenant.devices.map((d) => (
                <TableRow key={d.id}>
                  <TableCell dir="ltr" className="text-start font-mono text-xs">
                    {d.locationCode}
                  </TableCell>
                  <TableCell>
                    {d.name}
                    <span className="block text-xs text-muted-foreground">
                      {t(`admin:devices.types.${d.type}`)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Version value={d.appVersion} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(d.lastVersionAt, '—')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[d.versionStatus]}>
                      {t(`platform:releases.statuses.${d.versionStatus}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={d.online ? 'success' : 'secondary'}>
                      {d.online ? t('platform:health.online') : t('platform:health.offline')}
                    </Badge>{' '}
                    {formatDate(d.lastSeenAt, t('platform:shared.never'))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Releases and rollout (ADR 0026): the version the cloud runs and the oldest hub and app it
 * serves, the published releases, and every tenant's devices against its channel, with the
 * outdated and unsupported ones flagged.
 */
export function ReleasesPage() {
  const { t } = useTranslation('platform');
  const can = usePlatformCan();
  const [outdatedOnly, setOutdatedOnly] = useState(false);
  const overview = useQuery({ queryKey: ['releases'], queryFn: () => api.releases.overview() });
  const devices = useQuery({
    queryKey: ['device-versions', outdatedOnly],
    queryFn: () => api.releases.deviceVersions({ outdatedOnly: outdatedOnly ? 'true' : 'false' }),
    refetchInterval: 30_000,
  });

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={t('releases.title')}
        description={t('releases.description')}
        actions={can('releases.publish') ? <ReleaseDialog /> : null}
      />
      <QueryState query={overview}>
        {(data) => (
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <CardContent className="pt-6">
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <Fact label={t('releases.cloudVersion')}>
                    <Version value={data.cloudVersion} />
                  </Fact>
                  <Fact label={t('releases.minHubNow')}>
                    <Version value={data.minimums.hub} />
                  </Fact>
                  <Fact label={t('releases.minClientNow')}>
                    <Version value={data.minimums.client} />
                  </Fact>
                  <Fact label={t('releases.latestStable')}>
                    <Version value={data.latest.STABLE} />
                  </Fact>
                  <Fact label={t('releases.latestBeta')}>
                    <Version value={data.latest.BETA} />
                  </Fact>
                </dl>
              </CardContent>
            </Card>
            <section className="grid grid-cols-1 gap-3">
              <h2 className="text-lg font-semibold">{t('releases.published')}</h2>
              <ReleasesTable data={data} />
            </section>
            <section className="grid grid-cols-1 gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-lg font-semibold">{t('releases.devices')}</h2>
                <Field label={t('releases.show')} className="w-56">
                  <NativeSelect
                    value={outdatedOnly ? 'outdated' : 'all'}
                    onChange={(e) => {
                      setOutdatedOnly(e.target.value === 'outdated');
                    }}
                  >
                    <option value="all">{t('releases.allDevices')}</option>
                    <option value="outdated">{t('releases.outdatedOnly')}</option>
                  </NativeSelect>
                </Field>
              </div>
              <QueryState
                query={devices}
                isEmpty={(d) => d.tenants.length === 0}
                empty={{
                  title: outdatedOnly ? t('releases.nothingOutdated') : t('releases.noTenants'),
                }}
              >
                {(versions) => (
                  <div className="grid grid-cols-1 gap-4">
                    {versions.tenants.map((tenant) => (
                      <TenantVersions
                        key={tenant.tenantId}
                        tenant={tenant}
                        releases={data.releases}
                      />
                    ))}
                  </div>
                )}
              </QueryState>
            </section>
          </div>
        )}
      </QueryState>
    </div>
  );
}
