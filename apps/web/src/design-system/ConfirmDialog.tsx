import { AlertDialog as Radix } from 'radix-ui';
import type { ReactNode } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description: ReactNode;
  /** The button that does it, e.g. "Delete forever". */
  confirm: string;
  onConfirm(): void;
  /** A destructive action gets the danger button. */
  destructive?: boolean;
}

/** Asks before an action that can't be undone (Radix AlertDialog: focus starts on Cancel). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
  destructive,
}: ConfirmDialogProps) {
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="fixed inset-0 z-40 bg-[rgb(10_12_16/55%)]" />
        <Radix.Content className="fixed top-1/2 left-1/2 z-40 flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-dialog border border-line bg-raised p-5 text-ink shadow-raised">
          <Radix.Title className="text-lg font-semibold tracking-[-0.02em]">{title}</Radix.Title>
          <Radix.Description className="text-muted">{description}</Radix.Description>
          <div className="mt-2 flex justify-end gap-2">
            <Radix.Cancel asChild>
              <Button>Cancel</Button>
            </Radix.Cancel>
            <Radix.Action asChild>
              <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
                {confirm}
              </Button>
            </Radix.Action>
          </div>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
