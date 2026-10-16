import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { LanguageSwitcher } from './language-switcher';

describe('LanguageSwitcher', () => {
  it('switches the document to Arabic RTL and back to English LTR', async () => {
    await renderWithProviders(<LanguageSwitcher />);
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ar');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    // The control's own label is now translated.
    expect(screen.getByRole('combobox', { name: 'اللغة' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'اللغة' }), 'en');
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
  });
});
