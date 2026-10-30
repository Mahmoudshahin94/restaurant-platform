import type { PublishedMenu, PublishedMenuProduct } from '@pos/validation';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { ProductGrid } from './product-grid';

const id = (n: number) => `01890a5d-ac96-774b-bcce-b302099a80${String(n).padStart(2, '0')}`;

const product = (n: number, name: string, imageFileId: string | null): PublishedMenuProduct => ({
  id: id(n),
  sku: null,
  nameEn: name,
  nameAr: name,
  descriptionEn: null,
  descriptionAr: null,
  price: 1000,
  isAvailable: true,
  stationIds: [],
  taxIds: [],
  variants: [],
  barcodes: [],
  imageFileId,
  modifierGroups: [],
});

const menu: PublishedMenu = {
  tenantId: id(90),
  locationId: id(91),
  currencyCode: 'ILS',
  taxInclusive: true,
  version: 'v1',
  taxes: [],
  categories: [
    {
      id: id(80),
      nameEn: 'Mains',
      nameAr: 'رئيسية',
      descriptionEn: null,
      descriptionAr: null,
      products: [product(1, 'Burger', id(50)), product(2, 'Salad', null)],
    },
  ],
};

afterEach(cleanup);

/** Product pictures on the till (ADR 0027): tiles keep their names; a picture is decoration. */
describe('ProductGrid pictures', () => {
  it('shows a product’s cover from the hub, and text tiles for products without one', async () => {
    const pictureUrl = vi.fn((fileId: string) => `http://hub/api/v1/hub/media/${fileId}`);
    const { container } = await renderWithProviders(
      <ProductGrid menu={menu} onSelect={vi.fn()} pictureUrl={pictureUrl} />,
    );
    const pictures = container.querySelectorAll('img');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.getAttribute('src')).toBe(`http://hub/api/v1/hub/media/${id(50)}`);
    expect(pictures[0]?.getAttribute('alt')).toBe('');
    expect(screen.getByRole('button', { name: /Burger/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salad/ })).toBeInTheDocument();
  });

  it('shows text only when the till turned pictures off, or a picture cannot load', async () => {
    const off = await renderWithProviders(<ProductGrid menu={menu} onSelect={vi.fn()} />);
    expect(off.container.querySelectorAll('img')).toHaveLength(0);
    cleanup();

    const { container } = await renderWithProviders(
      <ProductGrid menu={menu} onSelect={vi.fn()} pictureUrl={(f) => `/missing/${f}`} />,
    );
    const picture = container.querySelector('img');
    expect(picture).not.toBeNull();
    fireEvent.error(picture!);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /Burger/ })).toBeInTheDocument();
  });
});
