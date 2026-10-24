import type { Order } from '@pos/validation';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/session';
import { renderWithProviders } from '../test/render';
import { KioskOrdersPrompt } from './kiosk-orders-prompt';

vi.mock('../lib/queries', () => ({ useLocationId: () => 'loc' }));

const order = (overrides: Partial<Order>): Order =>
  ({
    id: overrides.orderNumber ?? 'o',
    orderNumber: 'MAIN-001',
    channel: 'KIOSK',
    status: 'PLACED',
    paymentStatus: 'UNPAID',
    customerName: 'Lina',
    currencyCode: 'ILS',
    total: 3100,
    placedAt: '2026-10-24T10:00:00.000Z',
    ...overrides,
  }) as Order;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('kiosk orders to collect', () => {
  it('lists the unpaid kiosk orders waiting at the counter, oldest first', async () => {
    vi.spyOn(api.orders, 'list').mockResolvedValue([
      order({ orderNumber: 'MAIN-003', placedAt: '2026-10-24T10:05:00.000Z', customerName: null }),
      order({ orderNumber: 'MAIN-001' }),
      // Paid at the kiosk, or not a kiosk order: nothing to collect.
      order({ orderNumber: 'MAIN-002', paymentStatus: 'PAID' }),
      order({ orderNumber: 'MAIN-004', channel: 'TAKEAWAY' }),
    ]);
    await renderWithProviders(<KioskOrdersPrompt />, { features: { SELF_CHECKOUT: true } });
    expect(await screen.findByText('2 kiosk orders to collect at the counter')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /^Collect/ });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Collect MAIN-001',
      'Collect MAIN-003',
    ]);
    expect(screen.getByText('No name')).toBeInTheDocument();
  });

  it('is not there without SELF_CHECKOUT', async () => {
    const list = vi.spyOn(api.orders, 'list').mockResolvedValue([order({})]);
    await renderWithProviders(<KioskOrdersPrompt />, { features: { SELF_CHECKOUT: false } });
    expect(screen.queryByTestId('kiosk-orders-banner')).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});
