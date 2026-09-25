import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

export const fieldClass =
  'h-8 w-full rounded-input border border-line bg-transparent px-2 text-base text-ink placeholder:text-muted hover:border-muted focus-visible:border-accent focus-visible:outline-none aria-invalid:border-error';

/**
 * A text input. Numbers never use it: every numeric input is an
 * <ExpressionInput> (CLAUDE.md hard rule).
 */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className = '', type = 'text', ...props }, ref) {
    return <input ref={ref} type={type} className={`${fieldClass} ${className}`} {...props} />;
  },
);

/** A native select, styled like the inputs. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', ...props }, ref) {
    return <select ref={ref} className={`${fieldClass} bg-panel pr-1 ${className}`} {...props} />;
  },
);
