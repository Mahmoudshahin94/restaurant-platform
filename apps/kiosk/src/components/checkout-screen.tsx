import { useErrorText, useMoneyFormat } from '@pos/app-kit';
import type { OrderQuote } from '@pos/domain';
import type { KioskPaymentOption } from '@pos/shared-types';
import type { PublishedMenu } from '@pos/validation';
import { Alert, Button, Field, Input, cn } from '@pos/ui';
import { ArrowLeft, CreditCard, HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFocusOnMount } from '../lib/focus';
import type { CartLine } from '../stores/session';
import { CartPanel } from './cart-panel';

/** The last look before ordering: the order, an optional name, and how to pay. */
export function CheckoutScreen({
  menu,
  lines,
  quote,
  customerName,
  payment,
  pending,
  error,
  onName,
  onPayment,
  onBack,
  onSubmit,
}: {
  menu: PublishedMenu;
  lines: readonly CartLine[];
  quote: OrderQuote | null;
  customerName: string;
  payment: KioskPaymentOption;
  pending: boolean;
  error: unknown;
  onName: (name: string) => void;
  onPayment: (payment: KioskPaymentOption) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation('kiosk');
  const errorText = useErrorText();
  const { format } = useMoneyFormat(menu.currencyCode);
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const total = quote ? format(quote.pricing.total) : '';
  const option = (
    value: KioskPaymentOption,
    Icon: typeof CreditCard,
    title: string,
    hint: string,
  ) => (
    <button
      type="button"
      role="radio"
      aria-checked={payment === value}
      onClick={() => {
        onPayment(value);
      }}
      className={cn(
        'flex min-h-28 items-center gap-4 rounded-2xl border-2 p-5 text-start',
        payment === value ? 'border-primary bg-primary/10' : 'border-border bg-card',
      )}
    >
      <Icon aria-hidden className="size-10 shrink-0 text-primary" />
      <span className="grid gap-1">
        <span className="text-2xl font-bold">{title}</span>
        <span className="text-lg text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
  return (
    <main className="flex min-h-0 flex-1">
      <div className="grid min-h-0 flex-1 content-start gap-8 overflow-y-auto p-8">
        <h1 ref={heading} tabIndex={-1} className="text-4xl font-bold outline-none">
          {t('checkout.title')}
        </h1>
        <Field label={t('checkout.name')} hint={t('checkout.nameHint')}>
          <Input
            className="h-16 max-w-xl text-2xl"
            autoComplete="off"
            maxLength={60}
            value={customerName}
            onChange={(e) => {
              onName(e.target.value);
            }}
          />
        </Field>
        <fieldset className="grid gap-4">
          <legend className="mb-3 text-2xl font-semibold">{t('checkout.howToPay')}</legend>
          <div role="radiogroup" className="grid max-w-3xl gap-4 md:grid-cols-2">
            {option('TERMINAL', CreditCard, t('checkout.terminal'), t('checkout.terminalHint'))}
            {option('COUNTER', HandCoins, t('checkout.counter'), t('checkout.counterHint'))}
          </div>
        </fieldset>
        {error ? <Alert variant="destructive">{errorText(error)}</Alert> : null}
        <div className="flex flex-wrap gap-4">
          <Button type="button" variant="outline" size="xl" onClick={onBack}>
            <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
            {t('checkout.back')}
          </Button>
          <Button
            type="button"
            size="xl"
            className="h-16 min-w-72 text-xl"
            disabled={pending || !quote}
            onClick={onSubmit}
          >
            {payment === 'TERMINAL'
              ? t('checkout.payNow', { total })
              : t('checkout.placeOrder', { total })}
          </Button>
        </div>
      </div>
      <CartPanel
        menu={menu}
        lines={lines}
        quote={quote}
        problem={false}
        editable={false}
        actions={{ setQuantity: () => undefined, removeLine: () => undefined }}
        className="w-[26rem]"
      />
    </main>
  );
}
