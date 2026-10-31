import { useSyncExternalStore } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ChartSeries {
  key: string;
  label: string;
}

type Datum = Record<string, string | number>;

/** Series colours: theme tokens, so the chart follows the theme and the tenant's brand. */
const SERIES_COLORS = [
  'var(--color-primary)',
  'var(--color-accent)',
  'var(--color-warning)',
  'var(--color-info)',
  'var(--color-success)',
];
/** Lines also differ by dash pattern, so series are not told apart by colour alone. */
const LINE_DASHES = [undefined, '6 3', '2 3', '10 3 2 3', '1 5'];

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

/**
 * A bar or line chart (Recharts, admin only). The graphic is one labelled image for assistive
 * technology, and a visually hidden table lists every value so nothing depends on seeing the
 * picture. Animation is off under `prefers-reduced-motion`.
 */
export function Chart({
  data,
  series,
  x,
  xLabel,
  kind,
  ariaLabel,
  height = 280,
}: {
  data: Datum[];
  series: ChartSeries[];
  /** The key of the category (x axis) value in each datum. */
  x: string;
  /** The x column's heading in the data table; defaults to the key. */
  xLabel?: string;
  kind: 'bar' | 'line';
  ariaLabel: string;
  height?: number;
}) {
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const animate = !reduced;
  const axis = { stroke: 'var(--color-muted-foreground)', fontSize: 12 };
  const grid = (
    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
  );
  const common = (
    <>
      {grid}
      <XAxis
        dataKey={x}
        tickLine={false}
        tick={axis}
        axisLine={{ stroke: 'var(--color-border)' }}
      />
      <YAxis tickLine={false} axisLine={false} tick={axis} width={48} />
      <Tooltip
        contentStyle={{
          background: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-foreground)',
        }}
        cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
      />
      <Legend />
    </>
  );

  return (
    <figure className="m-0 w-full">
      <div role="img" aria-label={ariaLabel} dir="ltr" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          {kind === 'bar' ? (
            <BarChart data={data} accessibilityLayer={false}>
              {common}
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={animate}
                />
              ))}
            </BarChart>
          ) : (
            <LineChart data={data} accessibilityLayer={false}>
              {common}
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  strokeDasharray={LINE_DASHES[i % LINE_DASHES.length]}
                  dot={{ r: 3 }}
                  isAnimationActive={animate}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <table className="sr-only" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th scope="col">{xLabel ?? x}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((datum, row) => (
            <tr key={`${String(datum[x])}-${row}`}>
              <th scope="row">{String(datum[x])}</th>
              {series.map((s) => (
                <td key={s.key}>{String(datum[s.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
