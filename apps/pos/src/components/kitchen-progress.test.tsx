import type { Order } from '@pos/validation';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { KitchenProgress } from './kitchen-progress';

const order = {
  id: '01890a5d-ac96-774b-bcce-b302099a8001',
  status: 'CONFIRMED',
  tickets: [
    {
      id: '01890a5d-ac96-774b-bcce-b302099a8002',
      stationId: '01890a5d-ac96-774b-bcce-b302099a8003',
      stationNameEn: 'Grill',
      stationNameAr: 'الشواية',
      status: 'PREPARING',
      priority: 'NORMAL',
    },
  ],
} as unknown as Order;

describe('KitchenProgress', () => {
  it('shows the stations and the rush button where the KDS module is on', async () => {
    await renderWithProviders(
      <KitchenProgress order={order} canRush rushing={false} onRush={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { name: 'Kitchen' })).toBeInTheDocument();
  });

  it('is absent where the KDS module is off', async () => {
    const { container } = await renderWithProviders(
      <KitchenProgress order={order} canRush rushing={false} onRush={vi.fn()} />,
      { features: { KDS: false } },
    );
    expect(container).toBeEmptyDOMElement();
  });
});
