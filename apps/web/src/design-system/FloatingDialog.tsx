import { Dialog as Radix } from 'radix-ui';
import type { ReactNode } from 'react';

export interface FloatingDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Read out when it opens; not shown. */
  title: string;
  /** Where its top-left corner goes, in page px, kept on screen. Top centre when absent. */
  at?: { x: number; y: number };
  width: number;
  /** The height it may grow to, for keeping it on screen. */
  maxHeight: number;
  /** Dim the page behind it (the command palette), or leave it clear (the toolbox). */
  dim?: boolean;
  /** Called as it closes; return true to leave the focus where it went (another dialog opened). */
  keepFocus?(): boolean;
  children: ReactNode;
}

const MARGIN = 8;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * A borderless modal (Radix) for quick pickers: focus trap, Esc and a click
 * outside close it, focus returns where it was. No title bar: the body is
 * the whole dialog (P1-14's command palette and toolbox).
 */
export function FloatingDialog({
  open,
  onOpenChange,
  title,
  at,
  width,
  maxHeight,
  dim = false,
  keepFocus,
  children,
}: FloatingDialogProps) {
  const w = Math.min(width, globalThis.innerWidth - 2 * MARGIN);
  const style = at
    ? {
        width: w,
        maxHeight,
        left: clamp(at.x, MARGIN, globalThis.innerWidth - w - MARGIN),
        top: clamp(at.y, MARGIN, globalThis.innerHeight - maxHeight - MARGIN),
      }
    : { width: w, maxHeight, left: `calc(50% - ${w / 2}px)`, top: '12vh' };
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay
          className={`fixed inset-0 z-40 ${dim ? 'bg-[rgb(10_12_16/35%)]' : 'bg-transparent'}`}
        />
        <Radix.Content
          aria-describedby={undefined}
          style={style}
          className="fixed z-40 flex flex-col overflow-hidden rounded-dialog border border-line bg-raised text-ink shadow-raised"
          onCloseAutoFocus={(event) => {
            if (keepFocus?.()) event.preventDefault();
          }}
        >
          <Radix.Title className="sr-only">{title}</Radix.Title>
          {children}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
