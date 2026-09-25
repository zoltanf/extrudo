import { Popover as Radix } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

export interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
  /** Controlled state; leave both out for an uncontrolled popover. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
}

/** A non-modal popover (Radix) on a raised surface. */
export function Popover({
  trigger,
  children,
  side = 'bottom',
  label,
  open,
  onOpenChange,
}: PopoverProps) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Trigger asChild>{trigger}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className="z-50 rounded-dialog border border-line bg-raised p-3 text-base text-ink shadow-raised"
        >
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
