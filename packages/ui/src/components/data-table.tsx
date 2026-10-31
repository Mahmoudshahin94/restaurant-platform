import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** `end` right-aligns (left in RTL) and sets tabular numbers: use it for amounts and counts. */
  align?: 'start' | 'end';
  /** Makes the column sortable by this value. */
  sortValue?: (row: T) => string | number;
}

type SortState = { id: string; direction: 'asc' | 'desc' } | null;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * A data table: clicking a sortable header sorts ascending, then descending, then restores the
 * given order (`aria-sort` follows). The header stays in view while the body scrolls, and
 * `end`-aligned columns use tabular numbers. `density` sets the row height (40 px or 32 px).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  density = 'comfortable',
  className,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  density?: 'compact' | 'comfortable';
  className?: string;
}) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.id === sort.id) : undefined;
    const sortValue = column?.sortValue;
    if (!sort || !sortValue) return rows;
    const sign = sort.direction === 'asc' ? 1 : -1;
    // `Array.sort` is stable, so equal values keep the given order.
    return [...rows].sort((a, b) => sign * compare(sortValue(a), sortValue(b)));
  }, [columns, rows, sort]);

  function toggle(id: string) {
    setSort((current) => {
      if (current?.id !== id) return { id, direction: 'asc' };
      return current.direction === 'asc' ? { id, direction: 'desc' } : null;
    });
  }

  const rowHeight = density === 'compact' ? 'h-8' : 'h-10';
  return (
    <div
      className={cn(
        'surface max-h-[70vh] w-full overflow-auto rounded-lg border shadow-1',
        className,
      )}
    >
      <table className="w-full caption-bottom text-body-sm">
        <TableHeader className="sticky top-0 z-sticky bg-surface-raised">
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => {
              const sortable = column.sortValue !== undefined;
              const active = sort?.id === column.id ? sort.direction : null;
              const Icon =
                active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ChevronsUpDown;
              return (
                <TableHead
                  key={column.id}
                  scope="col"
                  aria-sort={
                    sortable
                      ? active === 'asc'
                        ? 'ascending'
                        : active === 'desc'
                          ? 'descending'
                          : 'none'
                      : undefined
                  }
                  className={cn(
                    'h-10 font-semibold text-foreground',
                    column.align === 'end' && 'text-end',
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => {
                        toggle(column.id);
                      }}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm font-semibold outline-none',
                        'focus-visible:ring-2 focus-visible:ring-ring',
                        column.align === 'end' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      <Icon
                        className={cn('size-3.5 shrink-0', !active && 'text-muted-foreground')}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length}
                className="py-8 text-center text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(
                      'py-0',
                      rowHeight,
                      column.align === 'end' && 'text-end tabular-nums',
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </table>
    </div>
  );
}
