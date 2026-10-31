import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DataTable } from './data-table';

interface Row {
  id: string;
  name: string;
  total: number;
}
const rows: Row[] = [
  { id: 'a', name: 'Burger', total: 30 },
  { id: 'b', name: 'Falafel', total: 5 },
  { id: 'c', name: 'Shawarma', total: 120 },
];
const columns = [
  { id: 'name', header: 'Name', cell: (r: Row) => r.name, sortValue: (r: Row) => r.name },
  {
    id: 'total',
    header: 'Total',
    align: 'end' as const,
    cell: (r: Row) => String(r.total),
    sortValue: (r: Row) => r.total,
  },
];

function bodyNames() {
  const body = screen.getAllByRole('rowgroup')[1]!;
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[0]!.textContent);
}

describe('DataTable', () => {
  it('renders every row in the given order, unsorted at first', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(bodyNames()).toEqual(['Burger', 'Falafel', 'Shawarma']);
    expect(screen.getByRole('columnheader', { name: 'Total' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('sorts a numeric column ascending, then descending, with aria-sort', async () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const header = screen.getByRole('columnheader', { name: 'Total' });
    await userEvent.click(within(header).getByRole('button', { name: 'Total' }));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyNames()).toEqual(['Falafel', 'Burger', 'Shawarma']);
    await userEvent.click(within(header).getByRole('button', { name: 'Total' }));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(bodyNames()).toEqual(['Shawarma', 'Burger', 'Falafel']);
    // The other column is unsorted again.
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none');
  });

  it('returns to the original order on a third click', async () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const button = within(screen.getByRole('columnheader', { name: 'Total' })).getByRole('button');
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);
    expect(bodyNames()).toEqual(['Burger', 'Falafel', 'Shawarma']);
  });

  it('sorts text with the locale collation', async () => {
    render(<DataTable columns={columns} rows={[...rows].reverse()} rowKey={(r) => r.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(bodyNames()).toEqual(['Burger', 'Falafel', 'Shawarma']);
  });

  it('gives a column without sortValue no sort button and no aria-sort', () => {
    render(
      <DataTable
        columns={[{ id: 'name', header: 'Name', cell: (r: Row) => r.name }]}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Name' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Name' })).not.toHaveAttribute('aria-sort');
  });

  it('aligns end columns with tabular numbers and a sticky header', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Total' })).toHaveClass('text-end');
    expect(screen.getAllByRole('cell', { name: '30' })[0]).toHaveClass('tabular-nums', 'text-end');
    expect(screen.getAllByRole('rowgroup')[0]).toHaveClass('sticky');
  });

  it('shows the empty content when there are no rows', () => {
    render(
      <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={<p>Nothing here</p>} />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('uses a compact row height when asked', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} density="compact" />);
    expect(screen.getAllByRole('cell', { name: 'Burger' })[0]).toHaveClass('h-8');
  });

  it('pads the scroll area by the header height so a focused cell is not hidden under it', () => {
    const { container, rerender } = render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />,
    );
    expect(container.firstElementChild).toHaveClass('overflow-auto', 'scroll-pt-10');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveClass('h-10');
    rerender(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} density="compact" />);
    expect(container.firstElementChild).toHaveClass('scroll-pt-8');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveClass('h-8');
  });

  describe('sorting edge cases', () => {
    interface Item {
      id: string;
      score: number | null | undefined;
      label: string;
    }
    const items: Item[] = [
      { id: '1', score: 5, label: 'a' },
      { id: '2', score: Number.NaN, label: 'b' },
      { id: '3', score: 5, label: 'c' },
      { id: '4', score: null, label: 'd' },
      { id: '5', score: 1, label: 'e' },
      { id: '6', score: undefined, label: 'f' },
      { id: '7', score: 5, label: 'g' },
    ];
    const itemColumns = [
      { id: 'label', header: 'Label', cell: (r: Item) => r.label },
      {
        id: 'score',
        header: 'Score',
        cell: (r: Item) => String(r.score),
        sortValue: (r: Item) => r.score,
      },
    ];
    function labels() {
      return within(screen.getAllByRole('rowgroup')[1]!)
        .getAllByRole('row')
        .map((row) => within(row).getAllByRole('cell')[0]!.textContent);
    }

    it('puts missing and NaN values last ascending, keeps ties in the given order', async () => {
      render(<DataTable columns={itemColumns} rows={items} rowKey={(r) => r.id} />);
      await userEvent.click(screen.getByRole('button', { name: 'Score' }));
      expect(labels()).toEqual(['e', 'a', 'c', 'g', 'b', 'd', 'f']);
    });

    it('still puts missing and NaN values last descending', async () => {
      render(<DataTable columns={itemColumns} rows={items} rowKey={(r) => r.id} />);
      const button = screen.getByRole('button', { name: 'Score' });
      await userEvent.click(button);
      await userEvent.click(button);
      expect(labels()).toEqual(['a', 'c', 'g', 'e', 'b', 'd', 'f']);
    });
  });
});
