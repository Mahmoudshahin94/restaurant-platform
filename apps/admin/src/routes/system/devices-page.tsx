import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey } from '@pos/app-kit';
import type { AdminDevice, PairDeviceRequest, PairedDevice, PairingCode } from '@pos/validation';
import {
  Alert,
  AlertDialog,
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
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { Ban, Copy, KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LocationRequired } from '../../components/location-required';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useDateTime, useLocationLookup } from '../../lib/format';
import { keys, useAdminMutation } from '../../lib/queries';
import { useSession } from '../../stores/session';

const AFFECTS = ['devices', 'sync-status', 'dashboard'];

type NewDeviceType = PairDeviceRequest['type'];
/** What can be added here: the location's hub, and the terminals its hub pairs (ADR 0022). */
const DEVICE_TYPES: readonly NewDeviceType[] = [
  'KIOSK',
  'GATEWAY',
  'POS',
  'KDS',
  'CUSTOMER_DISPLAY',
];

/** The command an owner runs on the hub machine (no secrets: it asks for the password). */
function pairCommand(cloudUrl: string, email: string, locationCode: string): string {
  return `pnpm --filter @pos/gateway pair -- --cloud ${cloudUrl} --email ${email} --location ${locationCode}`;
}

/** A terminal's one-time pairing code, large enough to read across a counter. */
function PairingCodeView({ pairing, locationId }: { pairing: PairingCode; locationId: string }) {
  const { t } = useTranslation('admin');
  const formatDate = useDateTime();
  return (
    <div className="grid gap-3">
      <Field label={t('devices.pairingCode')}>
        <output
          dir="ltr"
          className="block rounded-lg border-2 border-primary px-4 py-3 text-center font-mono text-4xl font-bold tracking-widest"
          data-testid="pairing-code"
        >
          {pairing.code}
        </output>
      </Field>
      <Alert>{t('devices.pairingHint', { time: formatDate(pairing.expiresAt, locationId) })}</Alert>
      <p className="text-sm text-muted-foreground">{t('devices.kioskSteps')}</p>
    </div>
  );
}

function AddDeviceDialog({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const [added, setAdded] = useState<PairedDevice | null>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<{ name: string; type: NewDeviceType }>({
    resolver: zodResolver(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, 'common:validation.required')
          .max(80, 'common:validation.tooLong'),
        type: z.enum(['GATEWAY', 'POS', 'KDS', 'KIOSK', 'CUSTOMER_DISPLAY']),
      }),
    ),
    defaultValues: { name: '', type: 'KIOSK' },
  });
  const type = form.watch('type');
  const pair = useAdminMutation(
    (body: { name: string; type: NewDeviceType }) => api.admin.devices.pair(locationId, body),
    AFFECTS,
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      setAdded(await pair.mutateAsync(values));
    } catch (error) {
      setFormError(errorText(error));
    }
  });
  const nameError = form.formState.errors.name?.message;
  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{t('admin:devices.addTitle')}</DialogTitle>
        <DialogDescription>{t('admin:devices.addHint')}</DialogDescription>
      </DialogHeader>
      {added ? (
        <div className="grid gap-3">
          {added.pairing ? (
            <PairingCodeView pairing={added.pairing} locationId={locationId} />
          ) : (
            <>
              <Alert>{t('admin:devices.credentialHint')}</Alert>
              <Field label={t('admin:devices.credential')}>
                <Input
                  dir="ltr"
                  readOnly
                  value={added.credential ?? ''}
                  className="font-mono text-xs"
                />
              </Field>
            </>
          )}
          <DialogFooter>
            {added.credential ? (
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(added.credential ?? '').then(() => {
                    setCopied(true);
                  });
                }}
              >
                <Copy aria-hidden />
                {copied ? t('admin:devices.copied') : t('admin:devices.copy')}
              </Button>
            ) : null}
            <Button onClick={onClose}>{t('common:actions.close')}</Button>
          </DialogFooter>
        </div>
      ) : (
        <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
          {formError ? <Alert variant="destructive">{formError}</Alert> : null}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('admin:devices.type')}</legend>
            {DEVICE_TYPES.map((value) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-lg border-2 px-3 py-2',
                  type === value ? 'border-primary bg-primary/10' : 'border-border',
                )}
              >
                <input type="radio" value={value} className="mt-1" {...form.register('type')} />
                <span className="grid">
                  <span className="font-medium">{t(`admin:devices.types.${value}`)}</span>
                  <span className="text-sm text-muted-foreground">
                    {t(`admin:devices.typeHints.${value}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label={t('admin:devices.name')} error={nameError ? tKey(t, nameError) : undefined}>
            <Input autoComplete="off" {...form.register('name')} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('admin:devices.add')}
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  );
}

function NewCodeDialog({ device, onClose }: { device: AdminDevice; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const renew = useAdminMutation(
    () => api.admin.devices.renewPairingCode(device.locationId, device.id),
    AFFECTS,
  );
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('admin:devices.newCodeTitle', { name: device.name })}</DialogTitle>
      </DialogHeader>
      {renew.error ? <Alert variant="destructive">{errorText(renew.error)}</Alert> : null}
      {pairing ? <PairingCodeView pairing={pairing} locationId={device.locationId} /> : null}
      <DialogFooter>
        {pairing ? (
          <Button onClick={onClose}>{t('common:actions.close')}</Button>
        ) : (
          <Button
            disabled={renew.isPending}
            onClick={() => {
              void renew.mutateAsync(undefined).then(setPairing, () => null);
            }}
          >
            <KeyRound aria-hidden />
            {t('admin:devices.newCode')}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

function DeviceList({ locationId }: { locationId: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const formatDate = useDateTime();
  const { byId } = useLocationLookup();
  const user = useSession((s) => s.user);
  const [adding, setAdding] = useState(false);
  const [renewing, setRenewing] = useState<AdminDevice | null>(null);
  const [disabling, setDisabling] = useState<AdminDevice | null>(null);
  const devices = useQuery({
    queryKey: keys.devices(locationId),
    queryFn: () => api.admin.devices.list(locationId),
    refetchInterval: 30_000,
  });
  const disable = useAdminMutation(
    (id: string) => api.admin.devices.disable(locationId, id),
    AFFECTS,
  );
  // The API is served from the portal's origin (or VITE_API_URL when it is elsewhere).
  const cloudUrl = (import.meta.env.VITE_API_URL as string | undefined) || window.location.origin;
  const command = pairCommand(cloudUrl, user?.email ?? '', byId.get(locationId)?.code ?? '');
  const now = Date.now();

  const connection = (d: AdminDevice) => {
    if (d.status === 'ACTIVE') {
      return (
        <Badge variant={d.online ? 'success' : 'warning'}>
          {d.online ? t('admin:devices.online') : t('admin:devices.offline')}
        </Badge>
      );
    }
    if (d.status === 'PENDING' && d.pairingExpiresAt) {
      const expired = new Date(d.pairingExpiresAt).getTime() <= now;
      return (
        <span className={cn('text-sm', expired ? 'text-destructive' : 'text-muted-foreground')}>
          {expired
            ? t('admin:devices.expired')
            : t('admin:devices.expires', { time: formatDate(d.pairingExpiresAt, locationId) })}
        </span>
      );
    }
    return null;
  };

  return (
    <div className="grid gap-6">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setAdding(true);
          }}
        >
          <Plus aria-hidden />
          {t('admin:devices.pair')}
        </Button>
      </div>
      <QueryState
        query={devices}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('admin:devices.empty'), description: t('admin:devices.emptyHint') }}
      >
        {(rows) => (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:devices.name')}</TableHead>
                  <TableHead>{t('admin:devices.type')}</TableHead>
                  <TableHead>{t('admin:shared.status')}</TableHead>
                  <TableHead>{t('admin:devices.connection')}</TableHead>
                  <TableHead>{t('admin:devices.lastSeen')}</TableHead>
                  <TableHead>{t('admin:devices.version')}</TableHead>
                  <TableHead>{t('admin:devices.outbox')}</TableHead>
                  <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{t(`admin:devices.types.${d.type}`)}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {d.status === 'PENDING'
                          ? t('admin:devices.waiting')
                          : t(`admin:devices.statuses.${d.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>{connection(d)}</TableCell>
                    <TableCell>
                      {d.lastSeenAt
                        ? formatDate(d.lastSeenAt, locationId)
                        : t('admin:shared.never')}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start font-mono text-xs">
                      {d.appVersion ?? ''}
                    </TableCell>
                    <TableCell className="ltr-nums">
                      {d.outbox
                        ? t('admin:devices.outboxValue', {
                            pending: d.outbox.pending,
                            failed: d.outbox.failed,
                          })
                        : ''}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1">
                        {d.status === 'PENDING' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setRenewing(d);
                            }}
                          >
                            <KeyRound aria-hidden />
                            {t('admin:devices.newCode')}
                          </Button>
                        ) : null}
                        {d.status !== 'DISABLED' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDisabling(d);
                            }}
                          >
                            <Ban aria-hidden />
                            {t('admin:devices.disable')}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </QueryState>
      <Card>
        <CardHeader>
          <CardTitle>{t('admin:devices.steps.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <ol className="grid list-decimal gap-2 ps-5">
            <li>{t('admin:devices.steps.one')}</li>
            <li>{t('admin:devices.steps.two')}</li>
            <li>{t('admin:devices.steps.three')}</li>
            <li>{t('admin:devices.steps.four')}</li>
          </ol>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">
              {t('admin:devices.steps.command')}
            </span>
            <pre dir="ltr" className="overflow-x-auto rounded-md bg-muted p-3 text-start text-xs">
              <code>{command}</code>
            </pre>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={adding}
        onOpenChange={(open) => {
          if (!open) setAdding(false);
        }}
      >
        {adding ? (
          <AddDeviceDialog
            locationId={locationId}
            onClose={() => {
              setAdding(false);
            }}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={renewing !== null}
        onOpenChange={(open) => {
          if (!open) setRenewing(null);
        }}
      >
        {renewing ? (
          <NewCodeDialog
            device={renewing}
            onClose={() => {
              setRenewing(null);
            }}
          />
        ) : null}
      </Dialog>
      <AlertDialog
        open={disabling !== null}
        title={t('admin:devices.disableTitle', { name: disabling?.name ?? '' })}
        description={t('admin:devices.disableBody')}
        confirmLabel={t('admin:devices.disable')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        onConfirm={() => disable.mutateAsync(disabling?.id ?? '')}
        errorText={errorText}
        onOpenChange={(open) => {
          if (!open) setDisabling(null);
        }}
      />
    </div>
  );
}

export function DevicesPage() {
  const { t } = useTranslation('admin');
  return (
    <>
      <PageHeader title={t('devices.title')} description={t('devices.description')} />
      <LocationRequired>
        {(locationId) => <DeviceList key={locationId} locationId={locationId} />}
      </LocationRequired>
    </>
  );
}
