import type { KitchenTicket } from '@pos/validation';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatElapsed } from '../lib/time';
import { renderWithProviders } from '../test/render';
import { TicketCard } from './ticket-card';

const NOW = Date.parse('2026-10-17T12:00:00.000Z');

function ticket(overrides: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: '01a14797-0000-7000-8000-000000000001',
    locationId: '01a14797-0000-7000-8000-000000000002',
    orderId: '01a14797-0000-7000-8000-000000000003',
    orderNumber: 'MAIN-042',
    orderStatus: 'CONFIRMED',
    channel: 'DINE_IN',
    tableLabel: 'T4',
    customerName: null,
    guestCount: 2,
    orderNotes: 'Birthday — bring a candle',
    stationId: '01a14797-0000-7000-8000-000000000004',
    stationCode: 'GRILL',
    stationNameEn: 'Grill',
    stationNameAr: 'الشواية',
    status: 'NEW',
    priority: 'NORMAL',
    version: 1,
    revision: 1,
    createdAt: new Date(NOW - 3 * 60_000 - 5_000).toISOString(),
    startedAt: null,
    readyAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: new Date(NOW).toISOString(),
    items: [
      {
        id: '01a14797-0000-7000-8000-000000000005',
        orderItemId: '01a14797-0000-7000-8000-000000000006',
        nameEn: 'Classic Burger',
        nameAr: 'برجر كلاسيك',
        variantNameEn: null,
        variantNameAr: null,
        quantity: 2,
        notes: 'No onions',
        modifiers: [{ nameEn: 'Medium', nameAr: 'متوسط' }],
        doneAt: null,
      },
    ],
    ...overrides,
  };
}

const thresholds = { warnMinutes: 8, lateMinutes: 15 };

async function renderCard(t: KitchenTicket, locale: 'en' | 'ar' = 'en') {
  const onAction = vi.fn();
  const view = await renderWithProviders(
    <TicketCard ticket={t} now={NOW} thresholds={thresholds} showStation onAction={onAction} />,
    { locale },
  );
  return { ...view, onAction };
}

describe('TicketCard', () => {
  it('shows what to cook with the order context and a running timer', async () => {
    await renderCard(ticket());
    const card = screen.getByRole('article', { name: 'MAIN-042' });
    expect(within(card).getByText('3:05')).toBeInTheDocument();
    expect(within(card).getByText('Dine-in')).toBeInTheDocument();
    expect(within(card).getByText('Table T4')).toBeInTheDocument();
    expect(within(card).getByText('2 guests')).toBeInTheDocument();
    expect(within(card).getByText('Classic Burger')).toBeInTheDocument();
    expect(within(card).getByText('+ Medium')).toBeInTheDocument();
    expect(within(card).getByText('No onions')).toBeInTheDocument();
    expect(within(card).getByText('Birthday — bring a candle')).toBeInTheDocument();
    expect(within(card).getByText('Grill')).toBeInTheDocument();
    // Status is spelled out, never colour alone.
    expect(within(card).getByText('New')).toBeInTheDocument();
  });

  it('offers the next step for each status', async () => {
    const user = userEvent.setup();
    const { onAction, unmount } = await renderCard(ticket());
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'transition', to: 'PREPARING' });
    unmount();

    const preparing = await renderCard(ticket({ status: 'PREPARING' }));
    await user.click(screen.getByRole('button', { name: 'Ready' }));
    expect(preparing.onAction).toHaveBeenLastCalledWith({ kind: 'transition', to: 'READY' });
    preparing.unmount();

    const ready = await renderCard(ticket({ status: 'READY' }));
    await user.click(screen.getByRole('button', { name: 'Bump' }));
    expect(ready.onAction).toHaveBeenLastCalledWith({ kind: 'transition', to: 'COMPLETED' });
    await user.click(screen.getByRole('button', { name: 'Not ready' }));
    expect(ready.onAction).toHaveBeenLastCalledWith({ kind: 'transition', to: 'PREPARING' });
    ready.unmount();

    const bumped = await renderCard(
      ticket({ status: 'COMPLETED', completedAt: new Date(NOW).toISOString() }),
    );
    await user.click(screen.getByRole('button', { name: 'Recall' }));
    expect(bumped.onAction).toHaveBeenLastCalledWith({ kind: 'transition', to: 'READY' });
    expect(screen.queryByRole('button', { name: 'Rush' })).not.toBeInTheDocument();
  });

  it('makes cancellations unmistakable and asks for acknowledgement', async () => {
    const user = userEvent.setup();
    const { onAction } = await renderCard(
      ticket({ status: 'CANCELLED', cancelledAt: new Date(NOW).toISOString() }),
    );
    expect(screen.getByText('Cancelled — stop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'dismiss' });
  });

  it('flags late, rushed and edited tickets in words', async () => {
    await renderCard(
      ticket({
        createdAt: new Date(NOW - 16 * 60_000).toISOString(),
        priority: 'RUSH',
        revision: 2,
      }),
    );
    expect(screen.getByText('Late')).toBeInTheDocument();
    expect(screen.getByText('Rush', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('strikes a line when the cook taps it', async () => {
    const user = userEvent.setup();
    const { onAction } = await renderCard(ticket());
    const line = screen.getByRole('button', { name: 'Mark Classic Burger done' });
    expect(line).toHaveAttribute('aria-pressed', 'false');
    await user.click(line);
    expect(onAction).toHaveBeenLastCalledWith({
      kind: 'itemDone',
      itemId: '01a14797-0000-7000-8000-000000000005',
      done: true,
    });
  });

  it('reads in Arabic, right to left', async () => {
    await renderCard(ticket(), 'ar');
    expect(screen.getByText('برجر كلاسيك')).toBeInTheDocument();
    expect(screen.getByText('+ متوسط')).toBeInTheDocument();
    expect(screen.getByText('طاولة T4')).toBeInTheDocument();
    expect(screen.getByText('الشواية')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ابدأ' })).toBeInTheDocument();
  });
});

describe('formatElapsed', () => {
  it('formats minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});
