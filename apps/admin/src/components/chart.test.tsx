import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chart } from './chart';

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
