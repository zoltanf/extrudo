import { X } from 'lucide-react';
import { useStore } from 'zustand';
import { ClampedText } from './ClampedText';
import { actionsOf, appNotifications, type Toast, type ToastTone } from './notifications';

export type { Toast, ToastAction, ToastOptions, ToastTone } from './notifications';

/**
 * Short messages after an action ("Exported bracket.extrudo."), some with a
 * button ("Sketch2 is hidden… Show"). Errors stay until dismissed. Every
 * message also goes into the session's history (`notifications`, P3-16), which
 * the status bar's bell opens.
 *
 * One store for the page (`appNotifications`): the two screens that call this
 * are the same session, and so is a message the platform pushed before the app
 * was mounted (the storage upgrade notices).
 */
export function useToasts() {
  const toasts = useStore(appNotifications, (s) => s.toasts);
  const { push, dismiss, keep } = appNotifications.getState();
  return { toasts, push, dismiss, keep, notifications: appNotifications };
}

/**
 * Just the toast stack, for the window between the page loading and the app
 * opening (where a slow IndexedDB upgrade is explained). It has no history
 * bell: there is no app to open one in yet.
 */
export function ToastsOnly() {
  const toasts = useStore(appNotifications, (s) => s.toasts);
  const { dismiss, keep } = appNotifications.getState();
  return <Toasts toasts={toasts} onDismiss={dismiss} onKeep={keep} />;
}

const DOT: Record<ToastTone, string> = {
  info: 'bg-sketch',
  success: 'bg-success',
  error: 'bg-error',
};

/** Where the stack sits: the window's corner, the view's, or the foot of a panel column. */
export type ToastPlace = 'screen' | 'view' | 'column';

/** The widest a toast gets, px (R3-17); longer text wraps, and past three lines it clamps. */
export const TOAST_MAX_WIDTH = 420;

const PLACES: Record<ToastPlace, string> = {
  screen: 'fixed right-4 bottom-4 z-50 max-w-[420px]',
  view: 'absolute right-3 bottom-3 z-30 max-w-[420px]',
  column: 'mt-auto max-w-full',
};

/**
 * The toast stack, bottom right, newest at the bottom, on raised surfaces
 * (docs/05-brand.md §5). A toast is at most `TOAST_MAX_WIDTH` wide and shows three
 * lines of a long message, with Show more for the rest; one opened that way stays until it
 * is dismissed (`onKeep`, R3-17). In a project it sits in the view's bottom-right
 * corner (`view`, inside the shell's positioned work area), or at the foot of
 * the sketch palette's column (`column`) so it never covers the palette.
 *
 * `clearRight` keeps that many px of the container's right edge free, for a
 * surface the stack must not cover — the open feature dialog's actions, whose
 * OK button the corner would otherwise sit on (12 seconds of "Sketch1 is
 * hidden…", and a click that goes nowhere).
 */
export function Toasts({
  toasts,
  onDismiss,
  onKeep,
  place = 'screen',
  clearRight,
}: {
  toasts: Toast[];
  onDismiss(id: number): void;
  /** A toast's long text was opened (Show more): it stays until dismissed (R3-17). */
  onKeep?(id: number): void;
  place?: ToastPlace;
  /** Px of the container's right edge the stack keeps clear. */
  clearRight?: number;
}) {
  return (
    <div
      className={`pointer-events-none flex flex-col items-end gap-2 ${PLACES[place]}`}
      style={clearRight ? { right: clearRight } : undefined}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          data-toast={t.tone}
          className="pointer-events-auto flex max-w-[min(420px,100%)] items-start gap-2.5 rounded-dialog border border-line bg-raised py-2.5 pr-2 pl-3 text-base text-ink shadow-raised"
        >
          <span
            className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[t.tone]}`}
            aria-hidden="true"
          />
          <ClampedText text={t.text} className="flex-1" onExpand={() => onKeep?.(t.id)} />
          {actionsOf(t).map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                onDismiss(t.id);
                action.run();
              }}
              className="-my-0.5 h-7 shrink-0 rounded-control px-2 font-medium text-accent hover:bg-accent-soft"
            >
              {action.label}
            </button>
          ))}
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
