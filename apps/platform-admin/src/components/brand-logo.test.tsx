import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { BrandLogo } from './brand-logo';

describe('BrandLogo', () => {
  it('keeps the wordmark at its own proportions instead of a square box', async () => {
    await renderWithProviders(<BrandLogo />);
    const logo = screen.getByRole('img', { name: 'MADAR Platform' });
    // The mark is 132 x 32: a height and an automatic width, never `size-*` or a fixed width.
    expect(logo.getAttribute('viewBox')).toBe('0 0 132 32');
    expect(logo).toHaveClass('h-7', 'w-auto');
    expect(logo.getAttribute('class')).not.toMatch(/\bsize-|\bw-\d/);
  });

  it('draws in theme colours, so it reads in light and dark', async () => {
    await renderWithProviders(<BrandLogo />);
    const logo = screen.getByRole('img', { name: 'MADAR Platform' });
    expect(logo.tagName.toLowerCase()).toBe('svg');
    expect(logo.querySelectorAll('[fill="#000"], [fill="black"]')).toHaveLength(0);
    expect(logo.querySelector('text')).toHaveTextContent('MADAR');
    expect(logo.querySelector('text')).toHaveClass('fill-foreground');
  });

  it('accepts a different height', () => {
    render(<BrandLogo className="h-8" label="x" />);
    expect(screen.getByRole('img', { name: 'x' })).toHaveClass('h-8', 'w-auto');
  });
});
