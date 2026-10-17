import {
  Button,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@pos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Cancellation always asks for a reason; it is stored in the order history and the audit log. */
export function CancelOrderDialog({
  orderNumber,
  pending,
  onConfirm,
}: {
  orderNumber: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation(['orders', 'common']);
  const [reason, setReason] = useState('');
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('orders:cancel.title', { number: orderNumber })}</DialogTitle>
        <DialogDescription>{t('orders:cancel.reasonHint')}</DialogDescription>
      </DialogHeader>
      <label className="grid gap-1.5">
        <span className="font-medium">{t('orders:cancel.reason')}</span>
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </label>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" size="lg">
            {t('orders:cancel.keep')}
          </Button>
        </DialogClose>
        <Button
          variant="destructive"
          size="lg"
          disabled={!reason.trim() || pending}
          onClick={() => {
            onConfirm(reason.trim());
          }}
        >
          {t('orders:cancel.confirm')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
