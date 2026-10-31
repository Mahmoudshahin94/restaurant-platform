import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';

export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}
    >
      <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
