import {
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '@pos/ui';
import { type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** A barcode typed by the customer when the scanner cannot read it (ADR 0021's manual entry). */
export function BarcodeDialog({ onSubmit }: { onSubmit: (code: string) => void }) {
  const { t } = useTranslation(['kiosk', 'common']);
  const [code, setCode] = useState('');
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (code.trim()) onSubmit(code.trim());
  };
  return (
    <DialogContent closeLabel={t('common:actions.close')} data-scanner-ignore="">
      <form className="grid gap-5" onSubmit={submit}>
        <DialogHeader>
          <DialogTitle className="text-2xl">{t('kiosk:scan.enterTitle')}</DialogTitle>
          <DialogDescription>{t('kiosk:scan.enterHint')}</DialogDescription>
        </DialogHeader>
        <Field label={t('kiosk:scan.field')}>
          <Input
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            className="h-16 text-center font-mono text-3xl"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
        </Field>
        <DialogFooter>
          <Button type="submit" size="touch" disabled={!code.trim()}>
            {t('kiosk:scan.submit')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
