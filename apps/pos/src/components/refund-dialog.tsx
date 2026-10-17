import { isApiError } from '@pos/api-client';
import { tKey, useErrorText, useMoneyFormat } from '@pos/app-kit';
import { newId, parseDecimalToMinor } from '@pos/domain';
import type { Order, OrderPayment } from '@pos/validation';
import {
  Alert,
  Button,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
} from '@pos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrderMutation } from '../lib/queries';
import { api } from '../lib/session';

/** Refunds part or all of one payment, with a mandatory reason (audited). */
export function RefundDialog({
  order,
  charge,
  refundable,
  shiftId,
  methodName,
  onDone,
}: {
  order: Order;
  charge: OrderPayment;
  refundable: number;
  shiftId: string;
  methodName: string;
  onDone: () => void;
}) {
  const { t } = useTranslation(['payments', 'common']);
  const errorText = useErrorText();
  const { format, toInput } = useMoneyFormat(order.currencyCode);
  const [amount, setAmount] = useState(toInput(refundable));
  const [reason, setReason] = useState('');
  const [refundId] = useState(newId);
  const [error, setError] = useState<string | null>(null);
  let minor: number | null = null;
  try {
    minor = parseDecimalToMinor(amount, order.currencyCode);
  } catch {
    minor = null;
  }

  const refund = useOrderMutation(() =>
    api.payments.refund(order.locationId, order.id, charge.id, {
      id: refundId,
      shiftId,
      amount: minor ?? 0,
      reason: reason.trim(),
    }),
  );
  const submit = async () => {
    setError(null);
    try {
      await refund.mutateAsync(undefined);
      onDone();
    } catch (e) {
      const why = isApiError(e) ? (e.details.reason as string | undefined) : undefined;
      setError(why ? tKey(t, `payments:reasons.${why}`) : errorText(e));
    }
  };
  const valid = minor !== null && minor > 0 && minor <= refundable && reason.trim() !== '';

  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('payments:refundTitle', { method: methodName })}</DialogTitle>
      </DialogHeader>
      <p className="text-muted-foreground">
        {t('payments:refundable', { amount: format(refundable) })}
      </p>
      <Field label={`${t('payments:amount')} (${order.currencyCode})`}>
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
      <label className="grid gap-1.5">
        <span className="font-medium">{t('payments:refundReason')}</span>
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </label>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <DialogFooter>
        <Button
          variant="destructive"
          size="touch"
          disabled={!valid || refund.isPending}
          onClick={() => void submit()}
        >
          {t('payments:refundConfirm', { amount: format(minor ?? 0) })}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
