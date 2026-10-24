import { useCurrentLocale, useFormatOptions, useMoneyFormat } from '@pos/app-kit';
import { formatMinorAsDecimal } from '@pos/domain';
import { formatBps, formatBusinessDate, formatNumber } from '@pos/i18n';
import {
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@pos/ui';
import { Download } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/** How a report value is shown (and exported). Money is always integer minor units. */
export type CellKind = 'money' | 'count' | 'percent' | 'duration' | 'date' | 'text';
export type CellValue = string | number | null;

export interface Column<R> {
  id: string;
  label: string;
  kind: CellKind;
  value: (row: R) => CellValue;
  /** The totals row's value; omitted = blank. */
  total?: CellValue;
  /** Draws a share bar next to a percentage. */
  bar?: boolean;
}

/** `h:mm:ss` or `m:ss`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s % 60)}` : `${String(m)}:${pad(s % 60)}`;
}

/** Byte order mark: tells Excel the file is UTF-8 (Arabic names). */
const BOM = String.fromCharCode(0xfeff);

/** Basis points as an exact decimal percentage for spreadsheets (4523 → "45.23"). */
function bpsDecimal(bps: number): string {
  const sign = bps < 0 ? '-' : '';
  const abs = Math.abs(bps);
  return `${sign}${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * A CSV document of the columns: a header row, the rows and the totals row. Values are plain
 * and locale-free (money as decimals of the currency, dates as YYYY-MM-DD) so spreadsheets read
 * them as numbers; text is quoted when needed. Starts with a BOM so Excel reads Arabic as UTF-8.
 */
export function toCsv<R>(
  columns: readonly Column<R>[],
  rows: readonly R[],
  currency: string,
  totalLabel: string,
): string {
  const raw = (kind: CellKind, value: CellValue): string => {
    if (value === null) return '';
    if (typeof value === 'string') return value;
    switch (kind) {
      case 'money':
        return formatMinorAsDecimal(value, currency);
      case 'percent':
        return bpsDecimal(value);
      case 'duration':
        return formatDuration(value);
      default:
        return String(value);
    }
  };
  const quote = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  const lines = [
    columns.map((c) => quote(c.label)),
    ...rows.map((r) => columns.map((c) => quote(raw(c.kind, c.value(r))))),
  ];
  if (columns.some((c) => c.total !== undefined)) {
    lines.push(
      columns.map((c, i) =>
        quote(i === 0 && c.total === undefined ? totalLabel : raw(c.kind, c.total ?? null)),
      ),
    );
  }
  return `${BOM}${lines.map((l) => l.join(',')).join('\r\n')}\r\n`;
}

/** Offers `content` as a file download (CSV export). */
export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Formats report values for the screen: money in the report's currency, Intl numbers and dates. */
export function useCellFormat(currency: string) {
  const locale = useCurrentLocale();
  const formatOptions = useFormatOptions();
  const { format } = useMoneyFormat(currency);
  return useCallback(
    (kind: CellKind, value: CellValue): string => {
      if (value === null) return '';
      if (typeof value === 'string') {
        return kind === 'date' ? formatBusinessDate(value, locale, formatOptions) : value;
      }
      switch (kind) {
        case 'money':
          return format(value);
        case 'percent':
          return formatBps(value, locale, formatOptions);
        case 'duration':
          return formatDuration(value);
        default:
          return formatNumber(value, locale, formatOptions);
      }
    },
    [format, formatOptions, locale],
  );
}

const NUMERIC: readonly CellKind[] = ['money', 'count', 'percent', 'duration'];

export function ReportTable<R>({
  caption,
  columns,
  rows,
  rowKey,
  currency,
}: {
  caption: string;
  columns: readonly Column<R>[];
  rows: readonly R[];
  rowKey: (row: R) => string;
  currency: string;
}) {
  const { t } = useTranslation('admin');
  const cell = useCellFormat(currency);
  const hasTotals = columns.some((c) => c.total !== undefined);
  const align = (c: Column<R>) => (NUMERIC.includes(c.kind) ? 'text-end' : undefined);
  const content = (c: Column<R>, value: CellValue) => {
    const text = cell(c.kind, value);
    if (!c.bar || typeof value !== 'number') return text;
    return (
      <span className="inline-flex items-center gap-2">
        <span aria-hidden className="h-2 w-16 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${String(Math.min(100, Math.max(0, value / 100)))}%` }}
          />
        </span>
        {text}
      </span>
    );
  };
  return (
    <Card className="overflow-x-auto">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.id} scope="col" className={cn('whitespace-nowrap', align(c))}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={rowKey(r)}>
              {columns.map((c, i) => (
                <TableCell
                  key={c.id}
                  className={cn(
                    'whitespace-nowrap',
                    align(c),
                    NUMERIC.includes(c.kind) && 'ltr-nums',
                    i === 0 && 'font-medium',
                  )}
                >
                  {content(c, c.value(r))}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {hasTotals ? (
          <tfoot className="border-t bg-muted/50 font-semibold">
            <TableRow>
              {columns.map((c, i) => (
                <TableCell
                  key={c.id}
                  className={cn(
                    'whitespace-nowrap',
                    align(c),
                    NUMERIC.includes(c.kind) && 'ltr-nums',
                  )}
                >
                  {i === 0 && c.total === undefined
                    ? t('reports.total')
                    : content(c, c.total ?? null)}
                </TableCell>
              ))}
            </TableRow>
          </tfoot>
        ) : null}
      </Table>
    </Card>
  );
}

export function ExportButton({ onExport }: { onExport: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <Button variant="outline" size="sm" onClick={onExport}>
      <Download aria-hidden />
      {t('reports.export')}
    </Button>
  );
}
