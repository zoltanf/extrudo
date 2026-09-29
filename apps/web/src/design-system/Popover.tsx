import { Popover as Radix } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

export interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  label?: string;
  /** Controlled state; leave both out for an uncontrolled popover. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** The trigger only places the popover; opening is up to `open` (a rename field on a chip). */
  anchorOnly?: boolean;
}

/** A non-modal popover (Radix) on a raised surface. */
export function Popover({
  trigger,
  children,
  side = 'bottom',
  align = 'center',
  label,
  open,
  onOpenChange,
  anchorOnly,
}: PopoverProps) {
  const Trigger = anchorOnly ? Radix.Anchor : Radix.Trigger;
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Trigger asChild>{trigger}</Trigger>
      <Radix.Portal>
        <Radix.Content
          side={side}
          align={align}
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
