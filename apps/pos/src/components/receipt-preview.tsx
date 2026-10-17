import { useErrorText } from '@pos/app-kit';
import type { ReceiptDocument } from '@pos/receipts';
import { Alert, Button, DialogContent, DialogFooter, DialogHeader, DialogTitle, cn } from '@pos/ui';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../lib/device';
import { printReceipt } from '../lib/printing';
import { usePreferences } from '../stores/preferences';

/** Text preview of the receipt (same content the printer receives) with a Print action. */
export function ReceiptPreview({ doc }: { doc: ReceiptDocument }) {
  const { t } = useTranslation(['payments', 'common']);
  const errorText = useErrorText();
  const printer = usePreferences((s) => s.printer);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const print = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await printReceipt(doc, printer);
      setStatus({ kind: 'ok', text: t('payments:printer.sent') });
    } catch (e) {
      const message =
        e instanceof Error && e.message === 'DESKTOP_ONLY'
          ? t('payments:printer.desktopOnly')
          : t('payments:printer.failed', { error: e instanceof Error ? e.message : errorText(e) });
      setStatus({ kind: 'error', text: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t('payments:printer.preview')}</DialogTitle>
      </DialogHeader>
      <article
        dir={doc.direction}
        lang={doc.locale}
        aria-label={t('payments:printer.preview')}
        data-testid="receipt"
        className="max-h-[60vh] overflow-y-auto rounded border bg-white p-4 text-sm text-black"
      >
        {doc.blocks.map((block, i) => {
          if (block.kind === 'divider')
            return <hr key={i} className="my-2 border-dashed border-black" />;
          if (block.kind === 'spacer') return <div key={i} className="h-4" />;
          if (block.kind === 'qr')
            return (
              <p key={i} className="break-all text-center text-xs">
                {block.data}
              </p>
            );
          if (block.kind === 'text') {
            return (
              <p
                key={i}
                className={cn(
                  block.align === 'center'
                    ? 'text-center'
                    : block.align === 'end'
                      ? 'text-end'
                      : 'text-start',
                  block.size === 'large' && 'text-lg',
                  block.bold && 'font-bold',
                  'whitespace-pre-wrap',
                )}
              >
                {block.text}
              </p>
            );
          }
          return (
            <p
              key={i}
              className={cn(
                'flex justify-between gap-3',
                block.bold && 'font-bold',
                block.size === 'large' && 'text-lg',
              )}
            >
              <span>{block.start}</span>
              <span className="whitespace-nowrap">{block.end}</span>
            </p>
          );
        })}
      </article>
      {status ? (
        <Alert variant={status.kind === 'error' ? 'destructive' : 'info'}>{status.text}</Alert>
      ) : null}
      <DialogFooter>
        <Button
          size="touch"
          disabled={busy || (printer.kind === 'network' && !isTauri())}
          onClick={() => void print()}
        >
          <Printer aria-hidden />
          {t('payments:printReceipt')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
