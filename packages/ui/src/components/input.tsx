import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

// leading-normal: inputs inherit line-height, and the taller Arabic body line-height would clip
// glyphs inside fixed-height controls.
const fieldClasses =
  'flex w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm leading-normal placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive';

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(fieldClasses, 'h-10', className)} {...props} />;
}

export function Textarea({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={cn(fieldClasses, 'min-h-20', className)} {...props} />;
}

/**
 * Native select: accessible, keyboard- and touch-friendly, mirrors correctly in RTL. Preferred
 * over a custom listbox for simple choices.
 */
export function NativeSelect({
  className,
  ref,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return <select ref={ref} className={cn(fieldClasses, 'h-10 pe-8', className)} {...props} />;
}
