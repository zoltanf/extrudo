import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent font-semibold hover:brightness-105',
  secondary: 'border border-line text-ink hover:bg-accent-soft',
  ghost: 'text-muted hover:text-ink hover:bg-accent-soft',
  danger: 'border border-error/60 text-error hover:bg-error/10',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/** A text button. 8 px radius, 13 px text (docs/05-brand.md §5). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-control px-3 text-base transition-colors duration-(--x-fast) ease-ui disabled:pointer-events-none disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name, also the tooltip's first line. */
  label: string;
  /** Shortcut shown in the tooltip, e.g. "Ctrl+Z". */
  shortcut?: string;
  /** Tooltip body below the label. */
  hint?: ReactNode;
  pressed?: boolean;
  children: ReactNode;
}

/** A square 32 px icon button with a tooltip (name, shortcut, hint). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, hint, pressed, className = '', type = 'button', children, ...props },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut} hint={hint}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        className={`inline-grid size-8 place-items-center rounded-control text-muted transition-colors duration-(--x-fast) ease-ui hover:bg-accent-soft hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-ink disabled:opacity-45 disabled:hover:bg-transparent ${className}`}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
});
