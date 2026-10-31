import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Card } from './card';

const percent = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/**
 * A headline number with its label, an optional hint and an optional change. `trend.value` is the
 * change in percent (positive is a rise) and `trend.label` says what it is measured against
 * ("vs last week"). The change is an icon plus a signed number plus words, never colour alone.
 */
export function StatCard({
  label,
  value,
  hint,
  trend,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  trend?: { value: number; label: string };
  className?: string;
}) {
  const direction = trend ? Math.sign(trend.value) : 0;
  const Icon = direction > 0 ? ArrowUp : direction < 0 ? ArrowDown : Minus;
  return (
    <Card className={cn('flex flex-col gap-1 p-(--card-pad) shadow-1', className)}>
      <p className="text-body-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-h2 font-semibold tabular-nums">{value}</p>
      {trend ? (
        <p
          className={cn(
            'flex items-center gap-1 text-body-sm',
            direction > 0 && 'text-success',
            direction < 0 && 'text-destructive',
            direction === 0 && 'text-muted-foreground',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="ltr-nums font-medium">{percent.format(trend.value)}%</span>
          <span className="text-muted-foreground">{trend.label}</span>
        </p>
      ) : null}
      {hint ? <p className="text-body-sm text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}
