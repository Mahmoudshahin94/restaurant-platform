import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatCard } from './stat-card';

describe('StatCard', () => {
  it('shows the label, value and hint', () => {
    render(<StatCard label="Net sales" value="₪1,200.00" hint="Last 7 days" />);
    expect(screen.getByText('Net sales')).toBeInTheDocument();
    expect(screen.getByText('₪1,200.00')).toHaveClass('tabular-nums');
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
  });

  it('says a rise in text and with an icon, not only colour', () => {
    render(<StatCard label="Orders" value="40" trend={{ value: 12.5, label: 'vs last week' }} />);
    const trend = screen.getByText(/vs last week/).closest('p')!;
    expect(trend).toHaveTextContent('+12.5%');
    expect(trend.querySelector('svg')).not.toBeNull();
    expect(trend).toHaveClass('text-success');
  });

  it('marks a fall as destructive and no change as neutral', () => {
    const { rerender } = render(
      <StatCard label="Orders" value="40" trend={{ value: -3, label: 'vs last week' }} />,
    );
    expect(screen.getByText(/vs last week/).closest('p')).toHaveTextContent('-3%');
    expect(screen.getByText(/vs last week/).closest('p')).toHaveClass('text-destructive');
    rerender(<StatCard label="Orders" value="40" trend={{ value: 0, label: 'vs last week' }} />);
    expect(screen.getByText(/vs last week/).closest('p')).toHaveClass('text-muted-foreground');
  });
});
