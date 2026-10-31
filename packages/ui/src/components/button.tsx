import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { type ButtonHTMLAttributes, useCallback, useLayoutEffect, useRef } from 'react';
import { cn } from '../lib/cn';

/**
 * The button spec (ADR 0028, design-system §5.1). Disabled is a neutral fill with muted text, never
 * the brand colour faded; hover uses `primary-hover`; pressed scales to .98 (not under reduced
 * motion, which the theme handles by zeroing durations).
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-[color,background-color,border-color,transform] duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[.98] disabled:cursor-not-allowed disabled:active:scale-100 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-surface-sunken disabled:text-muted-foreground',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-surface-sunken disabled:text-muted-foreground',
        outline:
          'border border-input bg-card hover:bg-muted disabled:border-border disabled:bg-surface-sunken disabled:text-muted-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:bg-surface-sunken disabled:text-muted-foreground',
        ghost: 'hover:bg-muted disabled:bg-transparent disabled:text-muted-foreground',
        link: 'text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline',
      },
      size: {
        /** 32: console only (lint keeps it out of POS, KDS and kiosk). */
        sm: 'h-8 px-3 text-xs [&_svg]:size-4',
        /** 40: the console default. */
        md: 'h-10 px-4 text-sm [&_svg]:size-4',
        /** 48: counter default, storefront primary action. */
        lg: 'h-12 px-6 text-base [&_svg]:size-4',
        /** 56: touch-first target (POS actions). */
        xl: 'h-14 min-w-14 px-6 text-lg [&_svg]:size-4',
        /** 72: kiosk start, pay and place order. */
        '2xl': 'h-18 min-w-18 px-8 text-xl [&_svg]:size-6',
        'icon-sm': 'size-8 [&_svg]:size-4',
        'icon-md': 'size-10 [&_svg]:size-4',
        'icon-lg': 'size-12 [&_svg]:size-4',
        'icon-xl': 'size-14 [&_svg]:size-4',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Busy: sets `aria-busy`, disables the button, shows a leading spinner and keeps the button's
   * width. The label may change meanwhile ("Saving…"). Icon sizes need an `aria-label`.
   */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading,
  type,
  ref,
  disabled,
  style,
  children,
  ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const Comp = asChild ? Slot : 'button';
  const own = useRef<HTMLButtonElement | null>(null);
  const idleWidth = useRef<number | null>(null);
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      own.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  // A button that can load remembers the width it has while idle, so the spinner (and a changed
  // label) does not resize it. Buttons without a `loading` prop never measure.
  useLayoutEffect(() => {
    if (loading === false && own.current) idleWidth.current = own.current.offsetWidth;
  });
  const busy = loading === true;
  return (
    <Comp
      ref={setRef}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? disabled : disabled || busy}
      aria-busy={busy || undefined}
      style={busy && idleWidth.current ? { minWidth: idleWidth.current, ...style } : style}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {busy ? <LoaderCircle aria-hidden className="motion-safe:animate-spin" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}
