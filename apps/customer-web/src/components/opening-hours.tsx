import type { OpeningWindowInput } from '@pos/validation';
import { useTranslation } from 'react-i18next';

/** A branch's weekly opening hours (times are the location's local times). */
export function OpeningHours({ windows }: { windows: readonly OpeningWindowInput[] }) {
  const { t } = useTranslation('customer');
  if (windows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('ordering.noHours')}</p>;
  }
  const days = [0, 1, 2, 3, 4, 5, 6] as const;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {days.flatMap((day) => {
        const today = windows.filter((w) => w.day === day);
        if (today.length === 0) return [];
        return [
          <dt key={`d${String(day)}`} className="font-medium">
            {t(`ordering.day.${String(day) as '0'}`)}
          </dt>,
          <dd key={`h${String(day)}`} className="ltr-nums">
            {today
              .map((w) =>
                w.open === w.close
                  ? t('ordering.allDay')
                  : t('ordering.window', { open: w.open, close: w.close }),
              )
              .join(' · ')}
          </dd>,
        ];
      })}
    </dl>
  );
}
