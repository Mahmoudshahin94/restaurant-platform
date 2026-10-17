import { Dialog } from '@pos/ui';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { burger, cola } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { ProductDialog } from './product-dialog';

describe('ProductDialog', () => {
  it('blocks adding until the required options are chosen, then prices the choice', async () => {
    const onConfirm = vi.fn();
    await renderWithProviders(
      <Dialog open>
        <ProductDialog product={burger} currency="SAR" onConfirm={onConfirm} />
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Choose the required options' })).toBeDisabled();
    expect(screen.getByText('Choose 1')).toBeInTheDocument();
    expect(screen.getByText('Up to 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Well done' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Cheese/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await userEvent.type(screen.getByLabelText('Special instructions'), ' No onions ');
    // (25.00 + 3.00) × 2
    await userEvent.click(screen.getByRole('button', { name: /Add to cart · SAR\s?56\.00/ }));
    expect(onConfirm).toHaveBeenCalledWith({
      productId: burger.id,
      variantId: null,
      modifierIds: [
        burger.modifierGroups[0]!.modifiers[1]!.id,
        burger.modifierGroups[1]!.modifiers[0]!.id,
      ],
      quantity: 2,
      notes: 'No onions',
    });
  });

  it('starts on the first size and shows sizes and prices in Arabic, right to left', async () => {
    const { container } = await renderWithProviders(
      <Dialog open>
        <ProductDialog product={cola} currency="SAR" onConfirm={vi.fn()} />
      </Dialog>,
      { locale: 'ar' },
    );
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'كولا' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /صغير/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /كبير/ }));
    expect(screen.getByRole('button', { name: /أضف إلى السلة/ })).toHaveTextContent('8.00');
    expect(container).toBeDefined();
  });
});
