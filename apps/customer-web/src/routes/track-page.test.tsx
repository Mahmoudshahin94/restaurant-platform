import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { id, publicOrder } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { TrackPage } from './track-page';

/** A placeholder in the token's shape (`<order id>.<signature>`); the page never checks it. */
const token = `${id(50)}.test-signature`;

function serve(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = (locale: 'en' | 'ar' = 'en') =>
  renderWithProviders(<TrackPage />, { locale, route: `/track/${token}`, path: '/track/:token' });

describe('TrackPage', () => {
  it('shows where the order stands, sending the token in a header', async () => {
    const fetchMock = serve(200, publicOrder());
    await render();
    expect(await screen.findByRole('heading', { name: 'Order W-007' })).toBeInTheDocument();
    expect(screen.getByTestId('order-status')).toHaveTextContent('Waiting for the store');
    expect(
      screen.getByText('The store has your order and will confirm it shortly.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Pay when you collect')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/orders/track');
    expect((init?.headers as Record<string, string>)['x-tracking-token']).toBe(token);
  });

  it('explains a cancellation and the voided payment, in Arabic', async () => {
    serve(
      200,
      publicOrder({
        status: 'CANCELLED',
        paymentOption: 'ONLINE_CARD',
        paymentStatus: 'REFUNDED',
        cancelReason: 'ACCEPTANCE_TIMEOUT',
      }),
    );
    await render('ar');
    expect(await screen.findByText('لم يؤكد المتجر الطلب في الوقت المحدد.')).toBeInTheDocument();
    expect(
      screen.getByText('أُلغيت عملية الدفع عبر الإنترنت: لن يُخصم منك أي مبلغ.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('order-status')).toHaveTextContent('ملغى');
  });

  it('says the order cannot be found for an unknown or forged token', async () => {
    serve(404, { code: 'ORDER_NOT_FOUND', message: 'x', details: {} });
    await render();
    expect(await screen.findByText('We could not find this order.')).toBeInTheDocument();
  });

  it('offers a retry when the site cannot reach the store', { timeout: 10_000 }, async () => {
    serve(503, { code: 'LOCATION_OFFLINE', message: 'x', details: {} });
    await render();
    // The page retries a failed check twice on its own before showing the error.
    expect(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 6000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('This location is offline right now.')).toBeInTheDocument();
  });
});
