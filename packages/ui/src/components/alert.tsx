import { CircleAlert, Info } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'destructive';
  title?: string;
  action?: ReactNode;
}

export function Alert({
  variant = 'info',
  title,
  action,
  className,
  children,
  ...props
}: AlertProps) {
  const Icon = variant === 'destructive' ? CircleAlert : Info;
  return (
    <div
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-md border p-4 text-sm',
        variant === 'destructive' ? 'border-destructive/50 text-destructive' : 'bg-muted',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="grid flex-1 gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-foreground/80">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
