import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey } from '@pos/app-kit';
import type { AdminDevice, PairedDevice } from '@pos/validation';
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
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { Ban, Copy, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { LocationRequired } from '../../components/location-required';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useDateTime, useLocationLookup } from '../../lib/format';
import { keys, useAdminMutation } from '../../lib/queries';
import { useSession } from '../../stores/session';

const AFFECTS = ['devices', 'sync-status', 'dashboard'];

/** The command an owner runs on the hub machine (no secrets: it asks for the password). */
function pairCommand(cloudUrl: string, email: string, locationCode: string): string {
  return `pnpm --filter @pos/gateway pair -- --cloud ${cloudUrl} --email ${email} --location ${locationCode}`;
}

function PairDialog({ locationId, onClose }: { locationId: string; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const [paired, setPaired] = useState<PairedDevice | null>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<{ name: string }>({
    resolver: zodResolver(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, 'common:validation.required')
          .max(80, 'common:validation.tooLong'),
      }),
    ),
    defaultValues: { name: '' },
  });
  const pair = useAdminMutation(
    ({ name }: { name: string }) => api.admin.devices.pair(locationId, { name, type: 'GATEWAY' }),
    AFFECTS,
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      setPaired(await pair.mutateAsync(values));
    } catch (error) {
      setFormError(errorText(error));
    }
  });
  const nameError = form.formState.errors.name?.message;
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('admin:devices.manualTitle')}</DialogTitle>
        <DialogDescription>{t('admin:devices.manualHint')}</DialogDescription>
      </DialogHeader>
      {paired ? (
        <div className="grid gap-3">
          <Alert>{t('admin:devices.credentialHint')}</Alert>
          <Field label={t('admin:devices.credential')}>
            <Input dir="ltr" readOnly value={paired.credential} className="font-mono text-xs" />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(paired.credential).then(() => {
                  setCopied(true);
                });
              }}
            >
              <Copy aria-hidden />
              {copied ? t('admin:devices.copied') : t('admin:devices.copy')}
            </Button>
            <Button onClick={onClose}>{t('common:actions.close')}</Button>
          </DialogFooter>
        </div>
      ) : (
        <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
          {formError ? <Alert variant="destructive">{formError}</Alert> : null}
          <Field
            label={t('admin:devices.hubName')}
            error={nameError ? tKey(t, nameError) : undefined}
          >
            <Input autoComplete="off" {...form.register('name')} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('admin:devices.pair')}
            </Button>
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  );
}

function DeviceList({ locationId }: { locationId: string }) {
  const { t } = useTranslation(['admin', 'common']);
  const formatDate = useDateTime();
  const { byId } = useLocationLookup();
  const user = useSession((s) => s.user);
  const [pairing, setPairing] = useState(false);
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

  return (
    <div className="grid gap-6">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setPairing(true);
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
                        {t(`admin:devices.statuses.${d.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.status === 'ACTIVE' ? (
                        <Badge variant={d.online ? 'success' : 'warning'}>
                          {d.online ? t('admin:devices.online') : t('admin:devices.offline')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {d.lastSeenAt
                        ? formatDate(d.lastSeenAt, locationId)
                        : t('admin:shared.never')}
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
                      {d.status === 'ACTIVE' ? (
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
        open={pairing}
        onOpenChange={(open) => {
          if (!open) setPairing(false);
        }}
      >
        {pairing ? (
          <PairDialog
            locationId={locationId}
            onClose={() => {
              setPairing(false);
            }}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={disabling !== null}
        title={t('admin:devices.disableTitle', { name: disabling?.name ?? '' })}
        body={t('admin:devices.disableBody')}
        confirmLabel={t('admin:devices.disable')}
        destructive
        onConfirm={() => disable.mutateAsync(disabling?.id ?? '')}
        onClose={() => {
          setDisabling(null);
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
