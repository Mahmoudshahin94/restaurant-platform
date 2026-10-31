import { useErrorText } from '@pos/app-kit';
import { Alert, Button, Spinner } from '@pos/ui';
import { CreditCard, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFocusOnMount } from '../lib/focus';

/**
 * At the card terminal: waiting for the customer's card, or the decline with the ways on (try
 * again, pay at the counter instead, or give up).
 */
export function PayingScreen({
  declined,
  pending,
  error,
  onRetry,
  onCounter,
  onCancel,
}: {
  declined: boolean;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  onCounter: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('kiosk');
  const errorText = useErrorText();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const failed = declined || (error !== null && !pending);
  return (
    <main className="grid min-h-full flex-1 place-items-center p-8 text-center">
      <div className="grid max-w-2xl justify-items-center gap-6">
        {failed ? (
          <XCircle aria-hidden className="size-20 text-destructive" />
        ) : (
          <CreditCard aria-hidden className="size-20 text-primary" />
        )}
        <h1 ref={heading} tabIndex={-1} className="text-4xl font-bold outline-none">
          {failed ? t('paying.declined') : t('paying.title')}
        </h1>
        <p className="text-2xl text-muted-foreground" role="status">
          {failed ? t('paying.declinedBody') : t('paying.body')}
        </p>
        {pending ? <Spinner label={t('paying.title')} className="size-12" /> : null}
        {error && !pending ? <Alert variant="destructive">{errorText(error)}</Alert> : null}
        {failed ? (
          <div className="grid w-full gap-3">
            <Button type="button" size="xl" className="h-16 text-xl" onClick={onRetry}>
              {t('paying.retry')}
            </Button>
            <Button type="button" variant="outline" size="xl" onClick={onCounter}>
              {t('paying.payAtCounter')}
            </Button>
            <Button type="button" variant="ghost" size="xl" onClick={onCancel}>
              {t('paying.cancel')}
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
