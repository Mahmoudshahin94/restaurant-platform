import { render, screen, within } from '@testing-library/react';
import { type ElementType, createElement } from 'react';
import type * as Recharts from 'recharts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart } from './chart';

// Records the `isAnimationActive` every animated Recharts part is given, then renders the real one.
const animation = vi.hoisted(() => ({ seen: [] as unknown[] }));
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof Recharts>();
  const record = (Component: ElementType) =>
    function Recorded(props: { isAnimationActive?: boolean }) {
      animation.seen.push(props.isAnimationActive);
      return createElement(Component, props);
    };
  return {
    ...actual,
    Bar: record(actual.Bar),
    Line: record(actual.Line),
    Tooltip: record(actual.Tooltip),
  };
});

// jsdom has no layout, so Recharts' responsive container would measure 0 and draw nothing.
class MeasuredResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const contentRect = { width: 600, height: 280 } as DOMRectReadOnly;
    this.callback([{ target, contentRect } as ResizeObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
}

function mockReducedMotion(reduced: boolean) {
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  animation.seen.length = 0;
});

const data = [
  { day: 'Mon', sales: 120, orders: 4 },
  { day: 'Tue', sales: 340, orders: 9 },
  { day: 'Wed', sales: 0, orders: 0 },
];
const series = [
  { key: 'sales', label: 'Sales' },
  { key: 'orders', label: 'Orders' },
];

describe.each(['bar', 'line'] as const)('Chart (%s)', (kind) => {
  it('lists every value in a hidden data table and labels the graphic', () => {
    render(<Chart data={data} series={series} x="day" kind={kind} ariaLabel="Sales by day" />);
    expect(screen.getByRole('img', { name: 'Sales by day' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Sales by day' });
    expect(table).toHaveClass('sr-only');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['day', 'Sales', 'Orders']);
    const body = within(table).getAllByRole('row').slice(1);
    expect(
      body.map((row) => [
        within(row).getByRole('rowheader').textContent,
        ...within(row)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ]),
    ).toEqual([
      ['Mon', '120', '4'],
      ['Tue', '340', '9'],
      ['Wed', '0', '0'],
    ]);
  });
});

describe('Chart value formatting', () => {
  it('shows values through formatValue in the data table', () => {
    render(
      <Chart
        data={data}
        series={[{ key: 'sales', label: 'Sales' }]}
        x="day"
        kind="line"
        ariaLabel="Sales by day"
        formatValue={(v) => `SAR ${v.toFixed(2)}`}
      />,
    );
    const table = screen.getByRole('table', { name: 'Sales by day' });
    expect(
      within(table)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['SAR 120.00', 'SAR 340.00', 'SAR 0.00']);
  });
});

describe.each(['bar', 'line'] as const)('Chart animation (%s)', (kind) => {
  it('turns every animation off under prefers-reduced-motion', () => {
    mockReducedMotion(true);
    render(<Chart data={data} series={series} x="day" kind={kind} ariaLabel="Sales by day" />);
    // Tooltip plus one part per series.
    expect(animation.seen.length).toBeGreaterThanOrEqual(1 + series.length);
    expect(animation.seen.every((value) => value === false)).toBe(true);
  });

  it('animates otherwise', () => {
    mockReducedMotion(false);
    render(<Chart data={data} series={series} x="day" kind={kind} ariaLabel="Sales by day" />);
    expect(animation.seen.length).toBeGreaterThanOrEqual(1 + series.length);
    expect(animation.seen.every((value) => value === true)).toBe(true);
  });
});
