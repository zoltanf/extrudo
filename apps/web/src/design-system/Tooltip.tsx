import { Tooltip as Radix } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

/** Wrap the app once; tooltips share one delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Radix.Provider delayDuration={500} skipDelayDuration={300}>
      {children}
    </Radix.Provider>
  );
}

export interface TooltipProps {
  label: ReactNode;
  shortcut?: string;
  hint?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}

/** Tool tooltip (UI spec §7): name, shortcut, one sentence. */
export function Tooltip({ label, shortcut, hint, side = 'bottom', children }: TooltipProps) {
  return (
    <Radix.Root>
      <Radix.Trigger asChild>{children}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-64 rounded-control border border-line bg-raised px-2.5 py-1.5 text-sm text-ink shadow-raised"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{label}</span>
            {shortcut && <kbd className="font-mono text-xs text-muted">{shortcut}</kbd>}
          </div>
          {hint && <div className="mt-0.5 text-muted">{hint}</div>}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
