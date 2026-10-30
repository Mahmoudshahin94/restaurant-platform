import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { ProductImagesEditor } from './product-images';

const FIRST = '01a146e8-0000-7000-8000-0000000000f1';
const SECOND = '01a146e8-0000-7000-8000-0000000000f2';

beforeEach(() => {
  // jsdom has no object URLs; thumbnails only need a string.
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The product editor's pictures (ADR 0027): upload, cover, order and removal. */
describe('ProductImagesEditor', () => {
  it('uploads the chosen pictures and adds them after the existing ones', async () => {
    signIn();
    const api = stubApi().on('POST', /\/products\/images$/, {
      id: SECOND,
      kind: 'PRODUCT_IMAGE',
      contentType: 'image/png',
      sizeBytes: 3,
      sha256: 'a'.repeat(64),
      createdAt: '2026-10-30T00:00:00.000Z',
    });
    const onChange = vi.fn();
    await renderWithProviders(<ProductImagesEditor value={[FIRST]} onChange={onChange} />);

    expect(screen.getByText('Cover')).toBeInTheDocument();
    const file = new File([new Uint8Array([1, 2, 3])], 'burger.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Add pictures'), file);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([FIRST, SECOND]);
    });
    expect(api.calls.some((c) => c.method === 'POST' && c.path.endsWith('/products/images'))).toBe(
      true,
    );
  });

  it('reorders pictures (the first is the cover) and removes one', async () => {
    signIn();
    stubApi();
    const onChange = vi.fn();
    await renderWithProviders(<ProductImagesEditor value={[FIRST, SECOND]} onChange={onChange} />);

    const later = screen.getAllByRole('button', { name: 'Move later' });
    expect(screen.getAllByRole('button', { name: 'Move earlier' })[0]).toBeDisabled();
    await userEvent.click(later[0]!);
    expect(onChange).toHaveBeenLastCalledWith([SECOND, FIRST]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove picture' })[1]!);
    expect(onChange).toHaveBeenLastCalledWith([FIRST]);
  });
});
