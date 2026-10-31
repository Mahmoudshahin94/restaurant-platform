import * as ToastPrimitive from '@radix-ui/react-toast';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '../lib/cn';

export type ToastVariant = 'default' | 'success' | 'destructive';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastItem extends ToastOptions {
  id: string;
}

/** How long a toast stays (design-system §5.2). */
const TOAST_DURATION_MS = 4000;

let toasts: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows a toast and returns its id (for `dismissToast`). Call it from anywhere. */
export function toast(options: ToastOptions): string {
  counter += 1;
  const id = `toast-${String(counter)}`;
  toasts = [...toasts, { ...options, id }];
  emit();
  return id;
}

export function dismissToast(id?: string): void {
  toasts = id ? toasts.filter((t) => t.id !== id) : [];
  emit();
}

export function useToast() {
  const current = useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
  return { toasts: current, toast, dismiss: dismissToast };
}

const ICONS = { default: Info, success: CircleCheck, destructive: CircleAlert } as const;

const VARIANT_CLASS: Record<ToastVariant, string> = {
  default: 'border-border',
  success: 'border-success',
  destructive: 'border-destructive',
};

const ICON_CLASS: Record<ToastVariant, string> = {
  default: 'text-info',
  success: 'text-success',
  destructive: 'text-destructive',
};

export interface ToasterProps {
  /** Translated accessible label of each toast's close button. */
  closeLabel: string;
  /** Translated name of the notifications region (default: Radix's "Notifications"). */
  label?: string;
}

/**
 * Renders the toasts. Mount it once per app. They are announced politely (`aria-live="polite"`),
 * last 4 seconds, never take focus, and pair colour with an icon.
 */
export function Toaster({ closeLabel, label }: ToasterProps) {
  const { toasts: items, dismiss } = useToast();
  return (
    <ToastPrimitive.Provider duration={TOAST_DURATION_MS} label={label}>
      {items.map(({ id, title, description, variant = 'default' }) => {
        const Icon = ICONS[variant];
        return (
          <ToastPrimitive.Root
            key={id}
            type="background"
            duration={TOAST_DURATION_MS}
            onOpenChange={(open) => {
              if (!open) dismiss(id);
            }}
            className={cn(
              'flex items-start gap-3 rounded-md border bg-surface-raised p-4 text-start text-card-foreground shadow-4',
              VARIANT_CLASS[variant],
            )}
          >
            <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', ICON_CLASS[variant])} />
            <div className="grid flex-1 gap-1">
              <ToastPrimitive.Title className="text-sm font-semibold">{title}</ToastPrimitive.Title>
              {description ? (
                <ToastPrimitive.Description className="text-sm text-muted-foreground">
                  {description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label={closeLabel}
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed bottom-0 end-0 z-toast m-0 flex w-full max-w-sm list-none flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  );
}
