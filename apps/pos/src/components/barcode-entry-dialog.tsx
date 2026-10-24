import { SCANNER_IGNORE_ATTRIBUTE } from '@pos/app-kit';
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BarcodeEntryDialogProps {
  /** Reports the typed code like a scan; the dialog closes when it was taken. */
  onSubmit: (code: string) => boolean;
}

/**
 * Manual barcode entry (ADR 0021): for a label that will not scan, or a till without a scanner.
 * The field is left alone by the keyboard-wedge scanner, so a scanner may type into it too.
 */
export function BarcodeEntryDialog({ onSubmit }: BarcodeEntryDialogProps) {
  const { t } = useTranslation(['pos', 'common']);
  const [code, setCode] = useState('');
  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t('pos:scan.title')}</DialogTitle>
        <DialogDescription>{t('pos:scan.hint')}</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        {...{ [SCANNER_IGNORE_ATTRIBUTE]: '' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (onSubmit(code)) setCode('');
        }}
      >
        <Field label={t('pos:scan.code')}>
          <Input
            autoFocus
            dir="ltr"
            inputMode="text"
            autoComplete="off"
            className="h-12 text-lg"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
        </Field>
        <DialogFooter>
          <Button type="submit" size="lg" disabled={code.trim() === ''}>
            {t('pos:scan.add')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
