import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './spinner';

describe('Spinner', () => {
  it('announces its label and only animates when motion is allowed', () => {
    render(<Spinner label="Loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    const icon = screen.getByRole('status').querySelector('svg');
    expect(icon).toHaveClass('motion-safe:animate-spin');
    expect(icon).not.toHaveClass('animate-spin');
  });
});
