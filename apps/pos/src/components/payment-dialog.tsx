import { isApiError } from '@pos/api-client';
import { tKey, useCurrentLocale, useErrorText, useMoneyFormat } from '@pos/app-kit';
import {
  currencyExponent,
  formatMinorAsDecimal,
  isDomainError,
  newId,
  parseDecimalToMinor,
  prepareCharge,
} from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { Order, PaymentMethod } from '@pos/validation';
import {
  Alert,
  Button,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  cn,
} from '@pos/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrderMutation } from '../lib/queries';
import { api } from '../lib/session';

interface PaymentDialogProps {
  order: Order;
  methods: PaymentMethod[];
  shiftId: string;
  cashRoundingIncrement: number | null;
  onPaid: (order: Order) => void;
}

function parseOrNull(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  try {
    return parseDecimalToMinor(value, currency);
  } catch {
    return null;
  }
}

/**
 * Quick cash buttons: the exact amount, then the amount rounded up to common note sizes
 * (e.g. 38.50 → 40, 50, 100), smallest first.
 */
export function quickTenders(cashDue: number, currency: string): number[] {
  const unit = 10 ** currencyExponent(currency);
  const roundUps = [5, 10, 20, 50, 100, 200, 500]
    .map((note) => Math.ceil(cashDue / (note * unit)) * note * unit)
    .filter((value) => value > cashDue);
  return [cashDue, ...[...new Set(roundUps)].sort((a, b) => a - b).slice(0, 3)];
}

/**
 * Takes one payment against an order; repeat for split bills. The preview (change, rounding,
 * validity) uses the domain's prepareCharge, the same rule the server applies. Each attempt
 * reuses one payment id, so a retry after a timeout cannot charge twice.
 */
export function PaymentDialog({
  order: initial,
  methods,
  shiftId,
  cashRoundingIncrement,
  onPaid,
}: PaymentDialogProps) {
  const { t } = useTranslation(['payments', 'orders', 'common']);
  const locale = useCurrentLocale();
  const errorText = useErrorText();
  const currency = initial.currencyCode;
  const { format, toInput } = useMoneyFormat(currency);
  const [order, setOrder] = useState(initial);
  const [methodId, setMethodId] = useState(
    methods.find((m) => m.type === 'CASH')?.id ?? methods[0]?.id ?? '',
  );
  const [amount, setAmount] = useState(toInput(initial.balanceDue));
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [paymentId, setPaymentId] = useState(newId);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const method = methods.find((m) => m.id === methodId);

  const amountMinor = parseOrNull(amount, currency);
  const tenderedMinor = parseOrNull(tendered, currency);
  const preview = useMemo(() => {
    if (!method || amountMinor === null) return null;
    try {
      return prepareCharge({
        orderStatus: order.status,
        method: method.type,
        balanceDue: order.balanceDue,
        amount: amountMinor,
        tendered: method.type === 'CASH' ? tenderedMinor : undefined,
        cashRoundingIncrement,
      });
    } catch (error) {
      if (isDomainError(error)) return error;
      throw error;
    }
  }, [method, amountMinor, tenderedMinor, order, cashRoundingIncrement]);

  const charge = useOrderMutation(() =>
    api.payments.charge(order.locationId, order.id, {
      id: paymentId,
      shiftId,
      paymentMethodId: methodId,
      amount: amountMinor ?? 0,
      tendered: method?.type === 'CASH' ? tenderedMinor : null,
      reference: method?.type === 'CARD' ? reference.trim() || null : null,
    }),
  );

  const submit = async () => {
    setResult(null);
    try {
      const { payment, order: updated } = await charge.mutateAsync(undefined);
      setOrder(updated);
      setPaymentId(newId());
      setTendered('');
      setReference('');
      setAmount(toInput(updated.balanceDue));
      setResult({
        kind: 'ok',
        text:
          payment.change > 0
            ? t('payments:done', { change: format(payment.change) })
            : t('payments:doneNoChange'),
      });
      onPaid(updated);
    } catch (error) {
      const reason = isApiError(error) ? (error.details.reason as string | undefined) : undefined;
      setResult({
        kind: 'error',
        text: reason ? tKey(t, `payments:reasons.${reason}`) : errorText(error),
      });
    }
  };

  const valid =
    preview !== null &&
    !isDomainError(preview) &&
    (method?.type !== 'CARD' || reference.trim() !== '');
  const cashDue =
    preview && !isDomainError(preview)
      ? preview.amount + preview.roundingAdjustment
      : (amountMinor ?? 0);
  const paidInFull = order.balanceDue === 0;

  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-xl">
      <DialogHeader>
        <DialogTitle className="text-2xl">
          {t('payments:title')} · <span className="ltr-nums">{order.orderNumber}</span>
        </DialogTitle>
      </DialogHeader>
      <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 text-lg">
        <dt>{t('orders:totals.total')}</dt>
        <dd className="text-end font-semibold">{format(order.total)}</dd>
        <dt>{t('payments:paid')}</dt>
        <dd className="text-end">{format(order.paidTotal - order.refundedTotal)}</dd>
        <dt className="font-bold">{t('payments:balanceDue')}</dt>
        <dd className="text-end text-2xl font-bold" data-testid="balance-due">
          {format(order.balanceDue)}
        </dd>
      </dl>

      {paidInFull ? (
        <Alert aria-live="polite">
          {result?.kind === 'ok'
            ? `${result.text} · ${t('payments:fullyPaid')}`
            : t('payments:fullyPaid')}
        </Alert>
      ) : (
        <div className="grid gap-4">
          <div
            role="radiogroup"
            aria-label={t('payments:method')}
            className="grid grid-cols-3 gap-2"
          >
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === methodId}
                onClick={() => {
                  setMethodId(m.id);
                }}
                className={cn(
                  'h-14 rounded-lg border-2 text-base font-semibold',
                  m.id === methodId ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                )}
              >
                {pickLocalized(m, 'name', locale)}
              </button>
            ))}
          </div>
          <Field label={`${t('payments:amount')} (${currency})`} hint={t('payments:amountHint')}>
            <Input
              inputMode="decimal"
              dir="ltr"
              className="h-12 text-lg"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
              }}
            />
          </Field>
          {method?.type === 'CASH' ? (
            <div className="grid gap-2">
              <Field label={`${t('payments:tendered')} (${currency})`}>
                <Input
                  inputMode="decimal"
                  dir="ltr"
                  className="h-12 text-lg"
                  placeholder={formatMinorAsDecimal(cashDue, currency)}
                  value={tendered}
                  onChange={(e) => {
                    setTendered(e.target.value);
                  }}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                {quickTenders(cashDue, currency).map((value, i) => (
                  <Button
                    key={value}
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setTendered(toInput(value));
                    }}
                  >
                    {i === 0 ? t('payments:exact') : format(value)}
                  </Button>
                ))}
              </div>
              {preview && !isDomainError(preview) ? (
                <dl className="grid grid-cols-2 gap-1 text-lg">
                  {preview.roundingAdjustment !== 0 ? (
                    <>
                      <dt>{t('payments:rounding')}</dt>
                      <dd className="text-end">{format(preview.roundingAdjustment)}</dd>
                    </>
                  ) : null}
                  <dt className="font-bold">{t('payments:change')}</dt>
                  <dd className="text-end text-2xl font-bold" data-testid="change">
                    {format(preview.change)}
                  </dd>
                </dl>
              ) : null}
            </div>
          ) : null}
          {method?.type === 'CARD' ? (
            <Field label={t('payments:reference')} hint={t('payments:referenceHint')}>
              <Input
                dir="ltr"
                className="h-12 text-lg"
                autoComplete="off"
                value={reference}
                onChange={(e) => {
                  setReference(e.target.value);
                }}
              />
            </Field>
          ) : null}
          {preview && isDomainError(preview) && amountMinor !== null ? (
            <Alert variant="destructive">
              {tKey(
                t,
                `payments:reasons.${typeof preview.details.reason === 'string' ? preview.details.reason : 'INVALID_AMOUNT'}`,
              )}
            </Alert>
          ) : null}
          {result ? (
            <Alert variant={result.kind === 'error' ? 'destructive' : 'info'} aria-live="polite">
              {result.text}
            </Alert>
          ) : null}
        </div>
      )}
      <DialogFooter>
        {paidInFull ? null : (
          <Button
            size="touch"
            className="w-full"
            disabled={!valid || charge.isPending}
            onClick={() => void submit()}
          >
            {charge.isPending
              ? t('payments:processing')
              : t('payments:confirm', { amount: format(amountMinor ?? 0) })}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
