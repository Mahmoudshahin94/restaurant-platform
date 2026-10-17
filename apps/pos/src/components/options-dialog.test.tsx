import type { PublishedMenuProduct } from '@pos/validation';
import { Dialog } from '@pos/ui';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { OptionsDialog } from './options-dialog';

const id = (n: number) => `01890a5d-ac96-774b-bcce-b302099a80${String(n).padStart(2, '0')}`;

const burger: PublishedMenuProduct = {
  id: id(1),
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
  modifierGroups: [
    {
      id: id(10),
      nameEn: 'Doneness',
      nameAr: 'الاستواء',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: id(11), nameEn: 'Medium', nameAr: 'متوسط', priceDelta: 0, isDefault: false },
        { id: id(12), nameEn: 'Well done', nameAr: 'مستوي', priceDelta: 0, isDefault: false },
      ],
    },
    {
      id: id(20),
      nameEn: 'Extras',
      nameAr: 'إضافات',
      minSelect: 0,
      maxSelect: 1,
      modifiers: [
        { id: id(21), nameEn: 'Cheese', nameAr: 'جبن', priceDelta: 300, isDefault: false },
      ],
    },
  ],
};

describe('OptionsDialog', () => {
  it('blocks adding until required choices are made, then prices the selection', async () => {
    const onConfirm = vi.fn();
    await renderWithProviders(
      <Dialog open>
        <OptionsDialog product={burger} currency="SAR" mode="add" onConfirm={onConfirm} />
      </Dialog>,
    );
    const incomplete = screen.getByRole('button', { name: 'Complete the required choices' });
    expect(incomplete).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'Well done' }));
    await userEvent.click(screen.getByRole('radio', { name: /Cheese/ }));
    const add = screen.getByRole('button', { name: /Add to order · SAR\s28\.00/ });
    await userEvent.click(add);
    expect(onConfirm).toHaveBeenCalledWith({
      variantId: null,
      modifierIds: [id(12), id(21)],
      notes: null,
    });
  });

  it('switches single-choice options instead of adding a second one', async () => {
    await renderWithProviders(
      <Dialog open>
        <OptionsDialog product={burger} currency="SAR" mode="add" onConfirm={vi.fn()} />
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Medium' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Well done' }));
    expect(screen.getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Well done' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('is fully translated in Arabic', async () => {
    await renderWithProviders(
      <Dialog open>
        <OptionsDialog product={burger} currency="SAR" mode="add" onConfirm={vi.fn()} />
      </Dialog>,
      { locale: 'ar' },
    );
    expect(screen.getByRole('heading', { name: 'برجر' })).toBeInTheDocument();
    expect(screen.getByText('إلزامي · اختر 1')).toBeInTheDocument();
  });
});
