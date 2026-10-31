import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster, toast } from './toast';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders in a polite status region and disappears after 4 seconds', () => {
    render(<Toaster closeLabel="Close" />);
    act(() => {
      toast({ title: 'Saved', description: 'Menu updated', variant: 'success' });
    });
    // Radix announces the text into its polite live region on the next frame.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Saved');
    expect(region).toHaveTextContent('Menu updated');
    expect(screen.getByRole('region', { name: /Notifications/ })).toHaveTextContent('Saved');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3700);
    });
    expect(screen.queryByText('Saved')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('does not take focus', () => {
    render(
      <>
        <button type="button">Other</button>
        <Toaster closeLabel="Close" />
      </>,
    );
    screen.getByRole('button', { name: 'Other' }).focus();
    act(() => {
      toast({ title: 'Hello' });
    });
    expect(screen.getByRole('button', { name: 'Other' })).toHaveFocus();
  });
});
