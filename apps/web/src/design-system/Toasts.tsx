import { X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

const LIFETIME_MS = 6000;

/** Short messages after an action ("Exported bracket.extrudo."). Errors stay until dismissed. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);
  const push = useCallback(
    (tone: ToastTone, text: string) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-2), { id, tone, text }]);
      if (tone !== 'error') setTimeout(() => dismiss(id), LIFETIME_MS);
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
