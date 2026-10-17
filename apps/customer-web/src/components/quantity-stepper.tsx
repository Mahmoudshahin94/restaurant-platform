import { Button } from '@pos/ui';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible name of the group, e.g. the product name. */
  label?: string;
}) {
  const { t } = useTranslation('customer');
  return (
    <div
      role="group"
      aria-label={label ?? t('product.quantity')}
      className="flex items-center gap-1"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('product.decrease')}
        disabled={value <= min}
        onClick={() => {
          onChange(value - 1);
        }}
      >
        <Minus aria-hidden />
      </Button>
      <output aria-live="polite" className="ltr-nums w-8 text-center font-semibold">
        {value}
      </output>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('product.increase')}
        disabled={value >= max}
        onClick={() => {
          onChange(value + 1);
        }}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}
