import { useCurrentLocale, useErrorText } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { KioskAttendant, KioskContext } from '@pos/validation';
import {
  Alert,
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '@pos/ui';
import { useMutation } from '@tanstack/react-query';
import { Maximize, Minimize, RefreshCw, Unplug, Users } from 'lucide-react';
import { type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

/**
 * Staff leaving the customer screens (ADR 0022): their employee code and PIN, checked by the hub
 * like a POS sign-in (and locked after repeated failures); `kiosk.attend` is required. No staff
 * session is created: the kiosk only opens its attendant menu.
 */
export function AttendantPinDialog({ onOpen }: { onOpen: (attendant: KioskAttendant) => void }) {
  const { t } = useTranslation(['kiosk', 'common']);
  const errorText = useErrorText();
  const [employeeCode, setCode] = useState('');
  const [pin, setPin] = useState('');
  const check = useMutation({
    mutationFn: () => api.attendant({ employeeCode: employeeCode.trim(), pin }),
  });
  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    try {
      onOpen(await check.mutateAsync());
    } catch {
      setPin('');
    }
  };
  return (
    <DialogContent closeLabel={t('common:actions.close')} data-scanner-ignore="">
      <form className="grid gap-5" noValidate onSubmit={(e) => void submit(e)}>
        <DialogHeader>
          <DialogTitle className="text-2xl">{t('kiosk:attendant.pinTitle')}</DialogTitle>
          <DialogDescription>{t('kiosk:attendant.pinHint')}</DialogDescription>
        </DialogHeader>
        {check.error ? <Alert variant="destructive">{errorText(check.error)}</Alert> : null}
        <Field label={t('kiosk:attendant.code')}>
          <Input
            dir="ltr"
            autoComplete="off"
            autoFocus
            className="h-14 text-xl"
            value={employeeCode}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
        </Field>
        <Field label={t('kiosk:attendant.pin')}>
          <Input
            dir="ltr"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            className="h-14 text-xl tracking-widest"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
            }}
          />
        </Field>
        <DialogFooter>
          <Button
            type="submit"
            size="touch"
            disabled={check.isPending || !employeeCode.trim() || pin.length < 4}
          >
            {t('kiosk:attendant.submit')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** What an attendant can do here: go back, reload the menu, full screen, unpair the kiosk. */
export function AttendantMenu({
  attendant,
  kiosk,
  version,
  onResume,
  onReload,
  onUnpair,
}: {
  attendant: KioskAttendant;
  kiosk: KioskContext;
  version: string;
  onResume: () => void;
  onReload: () => void;
  onUnpair: () => void;
}) {
  const { t } = useTranslation(['kiosk', 'common']);
  const locale = useCurrentLocale();
  const [confirming, setConfirming] = useState(false);
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Not allowed here (an embedded browser): nothing to do.
    }
    setFullscreen(document.fullscreenElement !== null);
  };
  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-2xl">
          <Users aria-hidden className="size-6" />
          {t('kiosk:attendant.title')}
        </DialogTitle>
        <DialogDescription>
          {t('kiosk:attendant.signedIn', { name: attendant.displayName })}
        </DialogDescription>
      </DialogHeader>
      <dl className="grid gap-1 text-sm text-muted-foreground">
        <dd>{t('kiosk:attendant.device', { name: kiosk.device.name })}</dd>
        <dd>
          {t('kiosk:attendant.location', { name: pickLocalized(kiosk.location, 'name', locale) })}
        </dd>
        <dd dir="ltr" className="text-start">
          {t('kiosk:attendant.version', { version })}
        </dd>
      </dl>
      {confirming ? (
        <Alert
          variant="destructive"
          title={t('kiosk:attendant.unpairTitle')}
          action={
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button variant="destructive" onClick={onUnpair}>
                {t('kiosk:attendant.unpair')}
              </Button>
            </div>
          }
        >
          {t('kiosk:attendant.unpairBody')}
        </Alert>
      ) : null}
      <div className="grid gap-3">
        <Button type="button" size="touch" onClick={onResume}>
          {t('kiosk:attendant.resume')}
        </Button>
        <Button type="button" variant="outline" size="touch" onClick={onReload}>
          <RefreshCw aria-hidden className="size-5" />
          {t('kiosk:attendant.reload')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? (
            <Minimize aria-hidden className="size-5" />
          ) : (
            <Maximize aria-hidden className="size-5" />
          )}
          {fullscreen ? t('kiosk:attendant.exitFullscreen') : t('kiosk:attendant.fullscreen')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="touch"
          className="text-destructive"
          onClick={() => {
            setConfirming(true);
          }}
        >
          <Unplug aria-hidden className="size-5" />
          {t('kiosk:attendant.unpair')}
        </Button>
      </div>
      <DialogFooter />
    </DialogContent>
  );
}
