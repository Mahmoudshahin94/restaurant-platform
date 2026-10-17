import { zodResolver } from '@hookform/resolvers/zod';
import { tKey, useMoneyFormat } from '@pos/app-kit';
import { newId } from '@pos/domain';
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
  Textarea,
} from '@pos/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAdminErrorText } from '../lib/admin-errors';
import { api } from '../lib/api';
import { moneyField } from '../lib/money';
import { useAdminMutation } from '../lib/queries';

interface RefundDialogProps {
  locationId: string;
  paymentId: string;
  orderNumber: string;
  refundable: number;
  currency: string;
  onClose: () => void;
}

/**
 * Refunds an online card charge from the admin portal. The refund id is created once per dialog,
 * so a retried submit is the same refund (the API is idempotent on it).
 */
export function RefundDialog({
  locationId,
  paymentId,
  orderNumber,
  refundable,
  currency,
  onClose,
}: RefundDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const { format, toInput } = useMoneyFormat(currency);
  const [refundId] = useState(() => newId());
  const [formError, setFormError] = useState<string | null>(null);
  const schema = z.object({
    amount: moneyField(currency).refine((v) => v >= 1 && v <= refundable, {
      message: 'common:validation.invalidAmount',
    }),
    reason: z
      .string()
      .trim()
      .min(1, 'common:validation.required')
      .max(300, 'common:validation.tooLong'),
  });
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { amount: toInput(refundable), reason: '' },
  });
  const save = useAdminMutation(
    (v: z.output<typeof schema>) =>
      api.admin.refund(locationId, paymentId, { id: refundId, amount: v.amount, reason: v.reason }),
    ['payments', 'order', 'orders', 'customers', 'dashboard'],
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      setFormError(errorText(error));
    }
  });
  const errors = form.formState.errors;
  const msg = (m?: string) => (m ? tKey(t, m) : undefined);
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('admin:payments.refundTitle', { number: orderNumber })}</DialogTitle>
        <DialogDescription>
          {t('admin:payments.refundMax', { amount: format(refundable) })}
        </DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <Field
          label={`${t('admin:payments.refundAmount')} (${currency})`}
          error={msg(errors.amount?.message)}
        >
          <Input inputMode="decimal" dir="ltr" className="w-40" {...form.register('amount')} />
        </Field>
        <Field
          label={t('admin:payments.refundReason')}
          hint={t('admin:payments.refundReasonHint')}
          error={msg(errors.reason?.message)}
        >
          <Textarea rows={2} {...form.register('reason')} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant="destructive" disabled={form.formState.isSubmitting}>
            {t('admin:payments.refund')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
