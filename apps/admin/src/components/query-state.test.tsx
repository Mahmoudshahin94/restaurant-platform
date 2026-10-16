import { ApiError } from '@pos/api-client';
import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { QueryState } from './query-state';

function Probe({ fn }: { fn: () => Promise<string[]> }) {
  const query = useQuery({ queryKey: ['probe'], queryFn: fn });
  return (
    <QueryState query={query} isEmpty={(d) => d.length === 0} empty={{ title: 'EMPTY' }}>
      {(data) => <p>{data.join(',')}</p>}
    </QueryState>
  );
}

describe('QueryState', () => {
  it('shows the localized API error with a working retry', async () => {
    const fn = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new ApiError('INSUFFICIENT_PERMISSION', 'x', 403))
      .mockResolvedValueOnce(['a', 'b']);
    await renderWithProviders(<Probe fn={fn} />, { locale: 'ar' });
    expect(await screen.findByText('ليست لديك صلاحية للقيام بذلك.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('a,b')).toBeInTheDocument();
  });

  it('renders the empty state', async () => {
    await renderWithProviders(<Probe fn={() => Promise.resolve([])} />);
    expect(await screen.findByText('EMPTY')).toBeInTheDocument();
  });
});
