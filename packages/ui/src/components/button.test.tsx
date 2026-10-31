import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('defaults to the primary variant at the md (40px) size', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveClass('bg-primary', 'h-10');
  });

  it.each([
    ['sm', 'h-8'],
    ['md', 'h-10'],
    ['lg', 'h-12'],
    ['xl', 'h-14'],
    ['2xl', 'h-18'],
    ['icon-sm', 'size-8'],
    ['icon-md', 'size-10'],
    ['icon-lg', 'size-12'],
    ['icon-xl', 'size-14'],
  ] as const)('size %s is %s', (size, cls) => {
    expect(buttonVariants({ size })).toContain(cls);
  });

  it('disables with a neutral fill instead of fading the brand colour', () => {
    const classes = buttonVariants({ variant: 'primary' });
    expect(classes).toContain('disabled:bg-surface-sunken');
    expect(classes).toContain('disabled:text-muted-foreground');
    expect(classes).toContain('disabled:cursor-not-allowed');
    expect(classes).not.toContain('opacity-50');
  });

  it('loading sets aria-busy, disables, keeps the label and shows a spinner', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Save/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Save');
    expect(button.querySelector('svg')).not.toBeNull();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the width it had before loading, even when the label changes', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(132);
    const { rerender } = render(<Button loading={false}>Save</Button>);
    expect(screen.getByRole('button')).not.toHaveStyle({ minWidth: '132px' });
    rerender(<Button loading>Saving…</Button>);
    expect(screen.getByRole('button')).toHaveStyle({ minWidth: '132px' });
    expect(screen.getByRole('button')).toHaveTextContent('Saving…');
    width.mockRestore();
  });

  it('is not busy by default', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button')).toBeEnabled();
  });
});
