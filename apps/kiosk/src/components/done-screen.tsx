import type { Order } from '@pos/validation';
import { Button } from '@pos/ui';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusOnMount } from '../lib/focus';

/** Seconds the order number stays on screen before the kiosk is ready for the next customer. */
export const DONE_SECONDS = 20;

/** The order number to listen for, and what happens next; then the kiosk starts over. */
export function DoneScreen({ order, onDone }: { order: Order; onDone: () => void }) {
  const { t } = useTranslation('kiosk');
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const [left, setLeft] = useState(DONE_SECONDS);
  useEffect(() => {
    const id = setInterval(() => {
      setLeft((s) => s - 1);
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);
  useEffect(() => {
    if (left <= 0) onDone();
  }, [left, onDone]);
  const next =
    order.status === 'COMPLETED'
      ? t('done.completed')
      : order.paymentStatus === 'PAID'
        ? t('done.kitchen')
        : t('done.counter');
  return (
    <main className="grid min-h-full flex-1 place-items-center p-8 text-center">
      <div className="grid max-w-3xl justify-items-center gap-6">
        <CheckCircle2 aria-hidden className="size-24 text-success" />
        <h1 ref={heading} tabIndex={-1} className="text-5xl font-bold outline-none">
          {t('done.thanks')}
        </h1>
        <p className="text-2xl text-muted-foreground">{t('done.number')}</p>
        <p
          className="ltr-nums rounded-3xl border-4 border-primary px-12 py-6 text-7xl font-black"
          data-testid="order-number"
          dir="ltr"
        >
          {order.orderNumber}
        </p>
        <p className="text-2xl" data-testid="done-message">
          {next}
        </p>
        <Button type="button" size="xl" className="h-16 min-w-64 text-xl" onClick={onDone}>
          {t('done.newOrder')}
        </Button>
        <p className="text-muted-foreground" aria-live="off">
          {t('done.restartIn', { seconds: Math.max(0, left) })}
        </p>
      </div>
    </main>
  );
}
