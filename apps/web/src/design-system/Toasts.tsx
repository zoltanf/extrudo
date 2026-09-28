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

/** The toast stack, bottom left, on raised surfaces (docs/05-brand.md §5). */
export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex max-w-96 flex-col gap-2">
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
