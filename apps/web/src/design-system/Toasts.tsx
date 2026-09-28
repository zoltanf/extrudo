import { X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

/** What a toast can carry besides its text. */
export interface ToastOptions {
  /** A button beside the text (e.g. "Show"); clicking it runs `run` and closes the toast. */
  action?: { label: string; run(): void };
  /** How long it stays, ms; errors stay until dismissed whatever this says. */
  lifetime?: number;
}

export interface Toast extends ToastOptions {
  id: number;
  tone: ToastTone;
  text: string;
}

const LIFETIME_MS = 6000;

/**
 * Short messages after an action ("Exported bracket.extrudo."), some with a
 * button ("Sketch2 is hidden… Show"). Errors stay until dismissed.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);
  const push = useCallback(
    (tone: ToastTone, text: string, options: ToastOptions = {}) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-2), { id, tone, text, ...options }]);
      if (tone !== 'error') setTimeout(() => dismiss(id), options.lifetime ?? LIFETIME_MS);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

const DOT: Record<ToastTone, string> = {
  info: 'bg-sketch',
  success: 'bg-success',
  error: 'bg-error',
};

/** Where the stack sits: the window's corner, the view's, or the foot of a panel column. */
export type ToastPlace = 'screen' | 'view' | 'column';

const PLACES: Record<ToastPlace, string> = {
  screen: 'fixed right-4 bottom-4 z-50 max-w-96',
  view: 'absolute right-3 bottom-3 z-30 max-w-96',
  column: 'mt-auto',
};

/**
 * The toast stack, bottom right, newest at the bottom, on raised surfaces
 * (docs/05-brand.md §5). In a project it sits in the view's bottom-right
 * corner (`view`, inside the shell's positioned work area), or at the foot of
 * the sketch palette's column (`column`) so it never covers the palette.
 */
export function Toasts({
  toasts,
  onDismiss,
  place = 'screen',
}: {
  toasts: Toast[];
  onDismiss(id: number): void;
  place?: ToastPlace;
}) {
  return (
    <div className={`pointer-events-none flex flex-col items-end gap-2 ${PLACES[place]}`}>
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex items-start gap-2.5 rounded-dialog border border-line bg-raised py-2.5 pr-2 pl-3 text-base text-ink shadow-raised"
        >
          <span
            className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[t.tone]}`}
            aria-hidden="true"
          />
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                onDismiss(t.id);
                t.action?.run();
              }}
              className="-my-0.5 h-7 shrink-0 rounded-control px-2 font-medium text-accent hover:bg-accent-soft"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onDismiss(t.id)}
            className="grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
