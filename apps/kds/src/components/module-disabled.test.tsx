import { FeatureGate } from '@pos/app-kit';
import { Feature } from '@pos/shared-types';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { ModuleDisabled } from './module-disabled';

afterEach(cleanup);

const board = (
  <FeatureGate feature={Feature.KDS} fallback={<ModuleDisabled />}>
    <p>Board</p>
  </FeatureGate>
);

describe('the kitchen screen without the KDS module', () => {
  it('shows the board where the module is on', async () => {
    await renderWithProviders(board);
    expect(screen.getByText('Board')).toBeInTheDocument();
  });

  it('says the module is off, in English and Arabic', async () => {
    await renderWithProviders(board, { features: { KDS: false } });
    expect(screen.queryByText('Board')).not.toBeInTheDocument();
    expect(screen.getByText('The kitchen display is off here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose another location' })).toBeInTheDocument();
    cleanup();
    await renderWithProviders(board, { features: { KDS: false }, locale: 'ar' });
    expect(screen.getByText('شاشة المطبخ غير مفعّلة هنا')).toBeInTheDocument();
  });
});
