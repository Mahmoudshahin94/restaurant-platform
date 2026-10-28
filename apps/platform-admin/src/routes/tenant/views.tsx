import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import type { Location, PlatformTenantDetail } from '@pos/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { usePlatformErrorText } from '../../lib/errors';
import { useDateTime } from '../../lib/format';
import { usePlatformCan } from '../../lib/permissions';

/** The tenant's locations by id, for lists that name them. */
export function useTenantLocations(tenantId: string) {
  return useQuery({
    queryKey: ['tenant', tenantId, 'locations'],
    queryFn: () => api.tenants.locations(tenantId),
  });
}

function useLocationName(tenantId: string) {
  const locale = useCurrentLocale();
  const { t } = useTranslation('platform');
  const locations = useTenantLocations(tenantId);
  return (id: string | null) => {
    if (!id) return t('tenant.tenantWide');
    const found = locations.data?.find((l: Location) => l.id === id);
    return found ? pickLocalized(found, 'name', locale) : id;
  };
}

function ListCard({ children }: { children: ReactNode }) {
  return <Card className="overflow-x-auto">{children}</Card>;
}

export function LocationsTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation(['platform', 'admin']);
  const locale = useCurrentLocale();
  const locations = useTenantLocations(tenantId);
  return (
    <QueryState
      query={locations}
      isEmpty={(d) => d.length === 0}
      empty={{ title: t('platform:tenant.noLocations') }}
    >
      {(list) => (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('platform:provision.locationCode')}</TableHead>
                <TableHead>{t('platform:tenant.location')}</TableHead>
                <TableHead>{t('platform:tenant.timezone')}</TableHead>
                <TableHead>{t('platform:tenants.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((l) => (
                <TableRow key={l.id}>
                  <TableCell dir="ltr" className="text-start font-mono">
                    {l.code}
                  </TableCell>
                  <TableCell>{pickLocalized(l, 'name', locale)}</TableCell>
                  <TableCell dir="ltr" className="text-start">
                    {l.timezone}
                  </TableCell>
                  <TableCell>
                    <Badge variant={l.isActive ? 'success' : 'secondary'}>
                      {l.isActive ? t('platform:tenant.active') : t('platform:tenant.inactive')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </QueryState>
  );
}

export function UsersTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation('platform');
  const formatDate = useDateTime();
  const locationName = useLocationName(tenantId);
  const users = useQuery({
    queryKey: ['tenant', tenantId, 'users'],
    queryFn: () => api.tenants.users(tenantId),
  });
  return (
    <QueryState
      query={users}
      isEmpty={(d) => d.length === 0}
      empty={{ title: t('tenant.noUsers') }}
    >
      {(list) => (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('provision.ownerName')}</TableHead>
                <TableHead>{t('provision.ownerEmail')}</TableHead>
                <TableHead>{t('tenant.roles')}</TableHead>
                <TableHead>{t('tenant.lastLogin')}</TableHead>
                <TableHead>{t('tenants.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.displayName}</TableCell>
                  <TableCell dir="ltr" className="text-start">
                    {u.email}
                  </TableCell>
                  <TableCell>
                    {u.roles.map((r, i) => (
                      <span key={`${r.roleName}-${String(i)}`} className="block text-xs">
                        {r.roleName} · {locationName(r.locationId)}
                      </span>
                    ))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(u.lastLoginAt, t('shared.never'))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? 'success' : 'secondary'}>
                      {u.isActive ? t('tenant.active') : t('tenant.inactive')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </QueryState>
  );
}

export function DevicesTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation(['platform', 'admin']);
  const formatDate = useDateTime();
  const locationName = useLocationName(tenantId);
  const devices = useQuery({
    queryKey: ['tenant', tenantId, 'devices'],
    queryFn: () => api.tenants.devices(tenantId),
  });
  return (
    <QueryState
      query={devices}
      isEmpty={(d) => d.length === 0}
      empty={{ title: t('platform:tenant.noDevices') }}
    >
      {(list) => (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin:devices.name')}</TableHead>
                <TableHead>{t('platform:tenant.type')}</TableHead>
                <TableHead>{t('platform:tenant.location')}</TableHead>
                <TableHead>{t('admin:devices.connection')}</TableHead>
                <TableHead>{t('platform:tenant.version')}</TableHead>
                <TableHead>{t('admin:devices.lastSeen')}</TableHead>
                <TableHead>{t('admin:devices.outbox')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell>
                    {t(`admin:devices.types.${d.type}`)}
                    <span className="block text-xs text-muted-foreground">
                      {t(`admin:devices.statuses.${d.status}`)}
                    </span>
                  </TableCell>
                  <TableCell>{locationName(d.locationId)}</TableCell>
                  <TableCell>
                    <Badge variant={d.online ? 'success' : 'secondary'}>
                      {d.online ? t('admin:devices.online') : t('admin:devices.offline')}
                    </Badge>
                  </TableCell>
                  <TableCell dir="ltr" className="text-start font-mono text-xs">
                    {d.appVersion ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(d.lastSeenAt, t('platform:shared.never'))}
                  </TableCell>
                  <TableCell className="ltr-nums">
                    {d.outbox
                      ? t('admin:devices.outboxValue', {
                          pending: d.outbox.pending,
                          failed: d.outbox.failed,
                        })
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </QueryState>
  );
}

function Swatch({ colour }: { colour: string | null }) {
  // A tenant's configured colour, shown as data (not a theme colour of this app).
  return colour ? (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block size-4 rounded border"
        style={{ backgroundColor: colour }}
      />
      <span dir="ltr" className="font-mono text-xs">
        {colour}
      </span>
    </span>
  ) : null;
}

export function BrandingTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation(['platform', 'admin']);
  const branding = useQuery({
    queryKey: ['tenant', tenantId, 'branding'],
    queryFn: () => api.tenants.branding(tenantId),
  });
  return (
    <QueryState query={branding}>
      {(data) => {
        const r = data.resolved;
        const inherited = (field: keyof typeof r.sources) =>
          r.sources[field] === 'PLATFORM' ? (
            <span className="ms-2 text-xs text-muted-foreground">
              {t('platform:branding.inherited')}
            </span>
          ) : null;
        return (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">{t('platform:branding.description')}</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>{t('platform:branding.names')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1 text-sm">
                  <p>
                    {r.displayNameEn}
                    {inherited('displayNameEn')}
                  </p>
                  <p dir="rtl">
                    {r.displayNameAr}
                    {inherited('displayNameAr')}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('platform:branding.colours')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <p>
                    {t('admin:branding.primaryColor')}: <Swatch colour={r.primaryColor} />
                    {inherited('primaryColor')}
                  </p>
                  <p>
                    {t('admin:branding.secondaryColor')}: <Swatch colour={r.secondaryColor} />
                    {inherited('secondaryColor')}
                  </p>
                  <p>
                    {t('admin:branding.accentColor')}: <Swatch colour={r.accentColor} />
                    {inherited('accentColor')}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>{t('platform:branding.look')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1 text-sm">
                  <p>
                    {t('admin:branding.themeMode')}: {t(`admin:branding.themeModes.${r.themeMode}`)}
                  </p>
                  <p>
                    {t('admin:branding.surfaceStyle')}:{' '}
                    {t(`admin:branding.surfaceStyles.${r.surfaceStyle}`)}
                  </p>
                  <p>
                    {t('admin:branding.fontFamily')}:{' '}
                    {t(`admin:branding.fontFamilies.${r.fontFamily}`)}
                  </p>
                  <p className="ltr-nums">
                    {t('admin:branding.borderRadius')}: {r.borderRadius}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

export function DomainsTab({ detail }: { detail: PlatformTenantDetail }) {
  const { t } = useTranslation(['platform', 'admin']);
  const tenantId = detail.tenant.id;
  const can = usePlatformCan();
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const domains = useQuery({
    queryKey: ['tenant', tenantId, 'domains'],
    queryFn: () => api.tenants.domains(tenantId),
  });
  const verify = useMutation({
    mutationFn: (domainId: string) => api.tenants.verifyDomain(tenantId, domainId),
  });
  const writable = detail.tenant.status !== 'ARCHIVED' && can('tenants.configure');

  const onVerify = async (domainId: string) => {
    setMessage(null);
    try {
      await verify.mutateAsync(domainId);
      setMessage({ ok: true, text: t('platform:domains.verified') });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'domains'] });
    }
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('platform:domains.description')}</p>
      {message ? <Alert variant={message.ok ? 'info' : 'destructive'}>{message.text}</Alert> : null}
      <QueryState
        query={domains}
        isEmpty={(d) => d.length === 0}
        empty={{ title: t('platform:domains.empty') }}
      >
        {(list) => (
          <ListCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:domains.domain')}</TableHead>
                  <TableHead>{t('platform:tenant.type')}</TableHead>
                  <TableHead>{t('platform:tenants.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell dir="ltr" className="text-start font-mono text-xs">
                      {d.domain}
                      {d.isPrimary ? (
                        <Badge variant="outline" className="ms-2">
                          {t('admin:domains.primary')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{t(`admin:domains.kinds.${d.kind}`)}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === 'VERIFIED' ? 'success' : 'secondary'}>
                        {t(`admin:domains.statuses.${d.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      {writable && d.kind === 'CUSTOM' && d.status !== 'DISABLED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={verify.isPending}
                          onClick={() => void onVerify(d.id)}
                        >
                          {verify.isPending
                            ? t('admin:domains.verifying')
                            : t('admin:domains.verify')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListCard>
        )}
      </QueryState>
    </div>
  );
}

export function PaymentsTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation(['platform', 'admin']);
  const locationName = useLocationName(tenantId);
  const overview = useQuery({
    queryKey: ['tenant', tenantId, 'payments'],
    queryFn: () => api.tenants.paymentAccounts(tenantId),
  });
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('platform:payments.description')}</p>
      <QueryState
        query={overview}
        isEmpty={(d) => d.accounts.length === 0}
        empty={{ title: t('platform:payments.empty') }}
      >
        {(data) => (
          <ListCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform:payments.account')}</TableHead>
                  <TableHead>{t('admin:paymentProviders.method')}</TableHead>
                  <TableHead>{t('platform:payments.scope')}</TableHead>
                  <TableHead>{t('admin:paymentProviders.mode')}</TableHead>
                  <TableHead>{t('platform:payments.secret')}</TableHead>
                  <TableHead>{t('platform:tenants.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      {t(`admin:paymentProviders.providers.${a.providerKey}`, a.providerKey)}
                    </TableCell>
                    <TableCell>{t(`admin:paymentProviders.methods.${a.method}`)}</TableCell>
                    <TableCell>{locationName(a.locationId)}</TableCell>
                    <TableCell>
                      <Badge variant={a.mode === 'TEST' ? 'warning' : 'default'}>
                        {t(`admin:paymentProviders.modes.${a.mode}`)}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid="secret-status">
                      {a.secret.hasSecret ? (
                        <span dir="ltr" className="font-mono text-xs">
                          {t('platform:payments.secretStored', {
                            fingerprint: a.secret.fingerprint ?? '',
                          })}
                        </span>
                      ) : (
                        t('platform:payments.noSecret')
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {a.status === 'ACTIVE'
                          ? t('platform:tenant.active')
                          : t('platform:tenant.inactive')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListCard>
        )}
      </QueryState>
    </div>
  );
}
