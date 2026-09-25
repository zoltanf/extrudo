import { Dialog as Radix } from 'radix-ui';
import type { ReactNode } from 'react';

export interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  /** Shown under the title, and read out when the dialog opens. */
  description?: ReactNode;
  /** Buttons on the right of the title bar (undo, close…). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A modal dialog (Radix): focus trap, Esc, focus return. A field that marks
 * itself `data-keep-escape` (an edited expression) gets Esc first, so Esc
 * reverts the field instead of closing the dialog. Focus starts in the first
 * field of the body.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  actions,
  children,
  className = '',
}: DialogProps) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-[rgb(10_12_16/55%)]" />
        <Radix.Content
          className={`fixed top-1/2 left-1/2 z-40 flex max-h-[calc(100vh-48px)] w-[min(1040px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-dialog border border-line bg-raised text-ink shadow-raised ${className}`}
          onOpenAutoFocus={(event) => {
            // Start in the first field rather than on the title-bar buttons.
            const field = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '[data-dialog-body] :is(input, select, textarea)',
            );
            if (field) {
              event.preventDefault();
              field.focus();
            }
          }}
          onEscapeKeyDown={(event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('[data-keep-escape]')) event.preventDefault();
          }}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <Radix.Title className="text-lg font-semibold tracking-[-0.02em]">
                {title}
              </Radix.Title>
              {description && (
                <Radix.Description className="text-sm text-muted">{description}</Radix.Description>
              )}
            </div>
            <div className="flex items-center gap-2">{actions}</div>
          </header>
          <div data-dialog-body className="min-h-0 overflow-auto px-6 py-4">
            {children}
          </div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export const DialogClose = Radix.Close;
