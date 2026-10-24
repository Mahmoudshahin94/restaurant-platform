import { cn } from '@pos/ui';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { useEffect } from 'react';

export interface ScanNotice {
  kind: 'ok' | 'error';
  text: string;
  /** Distinguishes two identical notices, so each one is shown for its full time. */
  key: number;
}

interface ScanToastProps {
  notice: ScanNotice | null;
  onDismiss: () => void;
  /** How long a notice stays, in ms. */
  duration?: number;
}

/**
 * What a scan did, at the bottom of the screen for a few seconds: the item added, or why nothing
 * was (an unknown code, a sold-out item). Announced to screen readers; errors assertively.
 */
export function ScanToast({ notice, onDismiss, duration = 3500 }: ScanToastProps) {
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(onDismiss, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [notice, onDismiss, duration]);

  if (!notice) return null;
  const Icon = notice.kind === 'ok' ? CircleCheck : CircleAlert;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        role={notice.kind === 'ok' ? 'status' : 'alert'}
        data-testid="scan-toast"
        className={cn(
          'pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-base font-medium shadow-lg',
          notice.kind === 'ok'
            ? 'bg-card text-foreground'
            : 'border-destructive bg-destructive text-destructive-foreground',
        )}
      >
        <Icon aria-hidden className="size-5 shrink-0" />
        <span>{notice.text}</span>
      </div>
    </div>
  );
}
