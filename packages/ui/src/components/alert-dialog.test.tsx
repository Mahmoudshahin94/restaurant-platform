import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AlertDialog } from './alert-dialog';

function setup(props: Partial<React.ComponentProps<typeof AlertDialog>> = {}) {
  const onConfirm = vi.fn();
  render(
    <AlertDialog
      title="Archive item?"
      description="It will no longer be sold."
      confirmLabel="Archive"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      trigger={<button type="button">Open</button>}
      {...props}
    />,
  );
  return { onConfirm };
}

describe('AlertDialog', () => {
  it('opens from its trigger as an alertdialog with title and description', async () => {
    setup();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Archive item?' });
    expect(dialog).toHaveAccessibleDescription('It will no longer be sold.');
  });

  it('calls onConfirm only on confirm, then closes', async () => {
    const { onConfirm } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });

  it('does not confirm on cancel or Escape', async () => {
    const { onConfirm } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stays open and shows the reason when the action fails', async () => {
    setup({
      onConfirm: vi.fn().mockRejectedValue(new Error('boom')),
      errorText: (e) => (e instanceof Error ? `Failed: ${e.message}` : 'Failed'),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Failed: boom')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('works controlled, without a trigger', async () => {
    const onOpenChange = vi.fn();
    render(
      <AlertDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Gone for good."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByRole('alertdialog', { name: 'Delete?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
