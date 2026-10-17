import type { OnlineOrderingOverview } from '@pos/validation';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreferences } from '../../stores/preferences';
import { LOC, signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { OnlineOrderingPage } from './online-ordering-page';

const overview: OnlineOrderingOverview = {
  state: 'OPEN',
  openingHours: [{ day: 5, open: '12:00', close: '01:00' }],
  acceptMinutes: 10,
  pickupEnabled: true,
  deliveryEnabled: false,
  deliveryFee: 900,
  status: { state: 'CLOSED', reason: 'OUTSIDE_HOURS' },
  hubLastSeenAt: null,
};

beforeEach(() => {
  usePreferences.setState({ locationId: LOC });
});
afterEach(() => {
  vi.unstubAllGlobals();
  usePreferences.setState({ locationId: null });
});

describe('online ordering page', () => {
  it('shows what customers see and saves the settings with numeric days', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/online-ordering$/, overview)
      .on('PUT', /\/online-ordering$/, (body) => ({ body: { ...overview, ...(body as object) } }));
    await renderWithProviders(<OnlineOrderingPage />);
    expect(await screen.findByText('Outside opening hours.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Open' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: 'Paused' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Delivery' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
        state: 'PAUSED',
        openingHours: [
          { day: 5, open: '12:00', close: '01:00' },
          { day: 0, open: '10:00', close: '22:00' },
        ],
        acceptMinutes: 10,
        pickupEnabled: true,
        deliveryEnabled: true,
        deliveryFee: 900,
      });
    });
  });

  it('is read-only without online_ordering.manage', async () => {
    signIn(['locations.view']);
    stubApi().on('GET', /\/online-ordering$/, overview);
    await renderWithProviders(<OnlineOrderingPage />, { locale: 'ar' });
    expect(await screen.findByText('خارج ساعات العمل.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حفظ' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'متوقف مؤقتًا' })).toBeDisabled();
  });
});
