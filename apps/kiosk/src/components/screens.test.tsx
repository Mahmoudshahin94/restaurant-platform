import type { Order, PublishedMenuProduct } from '@pos/validation';
import { Dialog } from '@pos/ui';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { DoneScreen } from './done-screen';
import { OptionsDialog } from './options-dialog';
import { PayingScreen } from './paying-screen';

const order = (overrides: Partial<Order>) =>
  ({
    id: 'o',
    orderNumber: 'MAIN-007',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    ...overrides,
  }) as Order;

const burger: PublishedMenuProduct = {
  id: '01890a5d-ac96-774b-bcce-b302099a8001',
  sku: null,
  nameEn: 'Burger',
  nameAr: 'برجر',
  descriptionEn: null,
  descriptionAr: null,
  price: 2500,
  isAvailable: true,
  stationIds: [],
  taxIds: [],
  variants: [],
  barcodes: [],
  imageFileId: null,
  modifierGroups: [
    {
      id: '01890a5d-ac96-774b-bcce-b302099a8002',
      nameEn: 'Doneness',
      nameAr: 'الاستواء',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8003',
          nameEn: 'Medium',
          nameAr: 'متوسط',
          priceDelta: 0,
          isDefault: false,
        },
        {
          id: '01890a5d-ac96-774b-bcce-b302099a8004',
          nameEn: 'Well done',
          nameAr: 'مستوٍ جيدًا',
          priceDelta: 200,
          isDefault: false,
        },
      ],
    },
  ],
};

describe('the done screen', () => {
  it.each([
    [order({}), 'We are preparing your order'],
    [order({ status: 'COMPLETED' }), 'Payment complete'],
    [order({ status: 'PLACED', paymentStatus: 'UNPAID' }), 'Please pay at the counter'],
  ])('tells the customer what happens next', async (o, message) => {
    await renderWithProviders(<DoneScreen order={o} onDone={() => undefined} />);
    expect(screen.getByTestId('order-number')).toHaveTextContent('MAIN-007');
    expect(screen.getByTestId('done-message')).toHaveTextContent(message);
    // Focus lands on the heading, so a screen reader announces the new step.
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('speaks Arabic, right to left, with the order number kept left to right', async () => {
    const { i18n } = await renderWithProviders(
      <DoneScreen order={order({})} onDone={() => undefined} />,
      { locale: 'ar' },
    );
    expect(i18n.dir('ar')).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('شكرًا لك!');
    expect(screen.getByTestId('order-number')).toHaveAttribute('dir', 'ltr');
  });
});

describe('paying at the terminal', () => {
  it('offers to retry, pay at the counter or cancel after a decline', async () => {
    const onCounter = vi.fn();
    await renderWithProviders(
      <PayingScreen
        declined
        pending={false}
        error={null}
        onRetry={() => undefined}
        onCounter={onCounter}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole('heading')).toHaveTextContent('The payment did not go through');
    await userEvent.click(screen.getByRole('button', { name: 'Pay at the counter instead' }));
    expect(onCounter).toHaveBeenCalled();
  });
});

describe('choosing options', () => {
  it('adds an item only once its required choice is made, priced by the domain', async () => {
    const onConfirm = vi.fn();
    await renderWithProviders(
      <Dialog open>
        <OptionsDialog product={burger} currency="ILS" onConfirm={onConfirm} />
      </Dialog>,
    );
    const add = screen.getByRole('button', { name: 'Make your choices' });
    expect(add).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /Well done/ }));
    await userEvent.click(screen.getByRole('button', { name: /One more Burger/ }));
    const confirm = screen.getByRole('button', { name: /Add to order/ });
    // (25.00 + 2.00) × 2
    expect(confirm).toHaveTextContent('54.00');
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      variantId: null,
      modifierIds: ['01890a5d-ac96-774b-bcce-b302099a8004'],
      quantity: 2,
    });
  });
});
