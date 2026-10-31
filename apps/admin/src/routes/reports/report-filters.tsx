import { businessDaysInRange } from '@pos/domain';
import { REPORT_MAX_DAYS } from '@pos/validation';
import { Field, Input, NativeSelect } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

export const PERIODS = ['today', 'yesterday', 'last7', 'thisMonth', 'lastMonth'] as const;
export type Period = (typeof PERIODS)[number];

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A preset's business dates, relative to today in the tenant's time zone. */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'thisMonth':
      return { from: monthStart, to: today };
    case 'lastMonth': {
      const lastDay = addDays(monthStart, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
  }
}

/**
 * The report filters kept in the query string (so a filtered report can be shared and survives a
 * reload): the date range (default: the last 7 days up to `today`) and any other `params`.
 * `set` changes some of them at once; an empty value removes a filter.
 */
export function useReportFilters(today: string) {
  const { t } = useTranslation('admin');
  const [params, setParams] = useSearchParams();
  const fallback = periodRange('last7', today);
  const from = params.get('from') ?? fallback.from;
  const to = params.get('to') ?? fallback.to;
  const period = PERIODS.find((p) => {
    const r = periodRange(p, today);
    return r.from === from && r.to === to;
  });
  const rangeError =
    !from || !to || from > to
      ? t('reports.filters.invalidRange')
      : businessDaysInRange(from, to) > REPORT_MAX_DAYS
        ? t('reports.filters.rangeTooLong', { days: REPORT_MAX_DAYS })
        : null;
  const set = (patch: Record<string, string>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!next.has('from')) next.set('from', from);
        if (!next.has('to')) next.set('to', to);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  };
  return { params, from, to, period, rangeError, set };
}

/** The period preset and the two date inputs of a report's filters. */
export function PeriodFields({
  from,
  to,
  period,
  today,
  set,
}: {
  from: string;
  to: string;
  period: Period | undefined;
  today: string;
  set: (patch: Record<string, string>) => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <>
      <Field label={t('reports.filters.period')}>
        <NativeSelect
          value={period ?? 'custom'}
          onChange={(e) => {
            const value = e.target.value as Period | 'custom';
            if (value !== 'custom') set(periodRange(value, today));
          }}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`reports.filters.periods.${p}`)}
            </option>
          ))}
          <option value="custom" disabled={period !== undefined}>
            {t('reports.filters.periods.custom')}
          </option>
        </NativeSelect>
      </Field>
      <Field label={t('shared.from')}>
        <Input
          type="date"
          dir="ltr"
          value={from}
          max={to}
          onChange={(e) => {
            set({ from: e.target.value });
          }}
        />
      </Field>
      <Field label={t('shared.to')}>
        <Input
          type="date"
          dir="ltr"
          value={to}
          min={from}
          onChange={(e) => {
            set({ to: e.target.value });
          }}
        />
      </Field>
    </>
  );
}
