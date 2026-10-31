import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { AppShell } from './app-shell';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell', () => {
  it('shows the logo at its own proportions and the organizations entry', async () => {
    signIn('VIEWER');
    stubApi();
    await renderWithProviders(<AppShell />);
    const logo = screen.getByRole('img', { name: 'MADAR Platform' });
    expect(logo).toHaveClass('h-7', 'w-auto');
    expect(logo.getAttribute('class')).not.toMatch(/\bsize-/);
    const nav = screen.getByRole('navigation', { name: 'Platform navigation' });
    expect(within(nav).getByRole('link', { name: 'Organizations' })).toHaveAttribute(
      'href',
      '/organizations',
    );
  });
});
