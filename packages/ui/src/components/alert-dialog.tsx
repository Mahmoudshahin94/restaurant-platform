import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { type ReactNode, useState } from 'react';
import { Alert } from './alert';
import { Button } from './button';

export interface AlertDialogProps {
  title: string;
  description: string;
  /** The confirming action, a verb ("Archive", "Delete"). */
  confirmLabel: string;
  cancelLabel: string;
  /** Styles the confirm button as destructive (archive, delete, void, refund). */
  destructive?: boolean;
  /**
   * Runs on confirm. A returned promise is awaited: the dialog stays open, with the confirm button
   * busy, until it resolves; if it rejects the dialog stays open and shows the reason.
   */
  onConfirm: () => unknown;
  /** Opens the dialog; omit it and drive the dialog with `open` and `onOpenChange` instead. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Turns a rejection into the text shown in the dialog (default: the error's message). */
  errorText?: (error: unknown) => string;
}

/**
 * Confirms an action that cannot be taken back lightly (ADR 0028). Radix AlertDialog: focus starts
 * on Cancel, Escape and Cancel close it, and clicking outside does not.
 */
export function AlertDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  trigger,
  open,
  onOpenChange,
  errorText,
}: AlertDialogProps) {
  const [inner, setInner] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOpen = open ?? inner;

  const change = (next: boolean) => {
    if (open === undefined) setInner(next);
    if (!next) setError(null);
    onOpenChange?.(next);
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      change(false);
    } catch (e) {
      setError(errorText ? errorText(e) : e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialogPrimitive.Root open={isOpen} onOpenChange={change}>
      {trigger ? (
        <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>
      ) : null}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-dialog bg-overlay" />
        <AlertDialogPrimitive.Content className="fixed start-1/2 top-1/2 z-dialog grid max-h-[90vh] w-full max-w-md -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-surface-raised p-6 shadow-3 ltr:-translate-x-1/2 rtl:translate-x-1/2">
          <div className="flex flex-col gap-1.5 text-start">
            <AlertDialogPrimitive.Title className="text-lg font-semibold">
              {title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
              {description}
            </AlertDialogPrimitive.Description>
          </div>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline">{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={destructive ? 'destructive' : 'primary'}
              loading={pending}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
