import { ThemeSwitcher, tKey, useCurrentLocale } from '@pos/app-kit';
import { PAPER_WIDTH_DOTS, type PaperWidth, type ReceiptDocument } from '@pos/receipts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Field,
  Input,
  Label,
  NativeSelect,
  Switch,
} from '@pos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReceiptPreview } from '../components/receipt-preview';
import { isTauri } from '../lib/device';
import { usePreferences } from '../stores/preferences';

/** Terminal settings: theme, menu pictures and the receipt printer used by this POS. */
export function SettingsPage() {
  const { t, i18n } = useTranslation(['payments', 'receipt', 'common', 'pos']);
  const locale = useCurrentLocale();
  const { printer, setPrinter, showPictures, setShowPictures } = usePreferences();
  const [testDoc, setTestDoc] = useState<ReceiptDocument | null>(null);

  const showTest = () => {
    const ft = i18n.getFixedT(locale);
    setTestDoc({
      locale,
      direction: locale === 'ar' ? 'rtl' : 'ltr',
      blocks: [
        {
          kind: 'text',
          text: tKey(ft, 'receipt:testTitle'),
          align: 'center',
          size: 'large',
          bold: true,
        },
        { kind: 'divider' },
        {
          kind: 'row',
          start: tKey(ft, 'payments:printer.paper'),
          end: printer.paper,
          bold: false,
          size: 'normal',
        },
        { kind: 'row', start: 'ABC abc 0123456789', end: 'أبجد هوز', bold: false, size: 'normal' },
        { kind: 'divider' },
        {
          kind: 'text',
          text: new Date().toISOString(),
          align: 'center',
          size: 'normal',
          bold: false,
        },
        { kind: 'spacer' },
      ],
    });
  };

  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('common:theme.label')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ThemeSwitcher className="h-12 w-full text-base" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('pos:menu.settings.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="show-pictures">{t('pos:menu.settings.pictures')}</Label>
            <p className="text-sm text-muted-foreground">{t('pos:menu.settings.picturesHint')}</p>
          </div>
          <Switch id="show-pictures" checked={showPictures} onCheckedChange={setShowPictures} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('payments:printer.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label={t('payments:printer.type')}>
            <NativeSelect
              className="h-12 text-base"
              value={printer.kind}
              onChange={(e) => {
                setPrinter(
                  e.target.value === 'network'
                    ? { kind: 'network', host: '', port: 9100, paper: printer.paper }
                    : { kind: 'browser', paper: printer.paper },
                );
              }}
            >
              <option value="browser">{t('payments:printer.browser')}</option>
              <option value="network">{t('payments:printer.network')}</option>
            </NativeSelect>
          </Field>
          {printer.kind === 'network' ? (
            <>
              {!isTauri() ? (
                <p className="text-sm text-muted-foreground">{t('payments:printer.desktopOnly')}</p>
              ) : null}
              <div className="grid grid-cols-[1fr_8rem] gap-3">
                <Field label={t('payments:printer.host')}>
                  <Input
                    dir="ltr"
                    className="h-12"
                    placeholder="192.168.1.50"
                    value={printer.host}
                    onChange={(e) => {
                      setPrinter({ ...printer, host: e.target.value.trim() });
                    }}
                  />
                </Field>
                <Field label={t('payments:printer.port')}>
                  <Input
                    dir="ltr"
                    className="h-12"
                    type="number"
                    min={9100}
                    max={9109}
                    value={printer.port}
                    onChange={(e) => {
                      setPrinter({ ...printer, port: Number(e.target.value) || 9100 });
                    }}
                  />
                </Field>
              </div>
            </>
          ) : null}
          <Field label={t('payments:printer.paper')}>
            <NativeSelect
              className="h-12 text-base"
              value={printer.paper}
              onChange={(e) => {
                setPrinter({ ...printer, paper: e.target.value as PaperWidth });
              }}
            >
              {(Object.keys(PAPER_WIDTH_DOTS) as PaperWidth[]).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button size="touch" variant="outline" onClick={showTest}>
            {t('payments:printer.test')}
          </Button>
        </CardContent>
      </Card>
      <Dialog
        open={testDoc !== null}
        onOpenChange={(o) => {
          if (!o) setTestDoc(null);
        }}
      >
        {testDoc ? <ReceiptPreview doc={testDoc} /> : null}
      </Dialog>
    </div>
  );
}
