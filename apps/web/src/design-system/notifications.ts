/**
 * The notification store (P3-16, ADR-0041): the live toasts and the session's
 * history of every notification, in one vanilla Zustand store per page. No
 * React and no DOM, so the logic runs in Node tests. The history is session
 * state only: it isn't stored with the document and is gone on reload.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

export type ToastTone = 'info' | 'success' | 'error';

/** A button beside a notification's text ("Show"). */
export interface ToastAction {
  label: string;
  /** Runs the action; in a toast it also closes the toast. */
  run(): void;
  /**
   * Whether the action still applies. The history asks whenever it draws
   * (opening it, and after an action ran), so a stale button, one whose
   * change is undone or already made, shows disabled. Absent: always applies.
   */
  available?(): boolean;
}

/** What a toast can carry besides its text. */
export interface ToastOptions {
  action?: ToastAction;
  /** How long it stays, ms; errors stay until dismissed whatever this says. */
  lifetime?: number;
}

export interface Toast extends ToastOptions {
  id: number;
  tone: ToastTone;
  text: string;
}

/** One entry of the history: a message and how often it came. */
export interface Notification {
  /** Stable for the entry; a repeat keeps it. */
  id: number;
  tone: ToastTone;
  text: string;
  /** How many times the same message was shown (≥ 1). */
  count: number;
  /** When it last came, ms since the epoch. */
  at: number;
  /** Order of the last occurrence, across the whole history (for unread). */
  seq: number;
  /** The action of the last occurrence. */
  action?: ToastAction;
}

export interface NotificationState {
  /** The toasts on screen, oldest first. */
  toasts: Toast[];
  /** Every notification of the session, newest first, at most `HISTORY_LIMIT`. */
  history: Notification[];
  /** Whether the history panel is open. */
  open: boolean;
  /** The `seq` the user has seen up to: opening the history sees everything. */
  seen: number;
  /** The `seq` of the newest occurrence. */
  seq: number;
  push(tone: ToastTone, text: string, options?: ToastOptions): void;
  dismiss(id: number): void;
  setOpen(open: boolean): void;
  /** Forgets the history (the toasts on screen stay). */
  clear(): void;
}

export type NotificationStore = StoreApi<NotificationState>;

export const TOAST_LIFETIME_MS = 6000;
/** Toasts on screen at once; older ones leave the stack (the history keeps them). */
export const TOAST_LIMIT = 3;
export const HISTORY_LIMIT = 100;

export interface NotificationEnv {
  now?(): number;
  /** Runs `fn` later (setTimeout); tests pass their own. */
  later?(fn: () => void, ms: number): void;
}

export function createNotifications(env: NotificationEnv = {}): NotificationStore {
  const now = env.now ?? Date.now;
  const later = env.later ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  let nextToast = 1;
  let nextEntry = 1;
  return createStore<NotificationState>((set, get) => ({
    toasts: [],
    history: [],
    open: false,
    seen: 0,
    seq: 0,
    push(tone, text, options = {}) {
      const id = nextToast++;
      const seq = get().seq + 1;
      set((s) => ({
        seq,
        // Looking at the history counts as seeing what arrives while it's open.
        seen: s.open ? seq : s.seen,
        toasts: [...s.toasts.slice(1 - TOAST_LIMIT), { id, tone, text, ...options }],
        history: record(
          s.history,
          { tone, text, at: now(), seq, action: options.action },
          () => nextEntry++,
        ),
      }));
      if (tone !== 'error') later(() => get().dismiss(id), options.lifetime ?? TOAST_LIFETIME_MS);
    },
    dismiss(id) {
      if (get().toasts.some((t) => t.id === id)) {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }
    },
    setOpen(open) {
      set((s) => (open ? { open, seen: s.seq } : { open }));
    },
    clear() {
      set({ history: [], seen: get().seq });
    },
  }));
}

/**
 * The history with one more notification: the same message again (tone and
 * text) raises the count of its entry and moves it to the top with the new
 * time and action; anything else is a new entry. Newest first.
 */
export function record(
  history: readonly Notification[],
  next: {
    tone: ToastTone;
    text: string;
    at: number;
    seq: number;
    action?: ToastAction | undefined;
  },
  newId: () => number,
): Notification[] {
  const same = history.find((n) => n.tone === next.tone && n.text === next.text);
  const entry: Notification = {
    id: same?.id ?? newId(),
    tone: next.tone,
    text: next.text,
    at: next.at,
    seq: next.seq,
    count: (same?.count ?? 0) + 1,
    ...(next.action && { action: next.action }),
  };
  return [entry, ...history.filter((n) => n !== same)].slice(0, HISTORY_LIMIT);
}

/** The history in the panel's order: errors first, each group newest first. */
export function grouped(history: readonly Notification[]): {
  errors: Notification[];
  others: Notification[];
} {
  return {
    errors: history.filter((n) => n.tone === 'error'),
    others: history.filter((n) => n.tone !== 'error'),
  };
}

/** How many entries came since the history was last seen, and whether one is an error. */
export function unread(state: Pick<NotificationState, 'history' | 'seen'>): {
  count: number;
  errors: number;
} {
  const fresh = state.history.filter((n) => n.seq > state.seen);
  return { count: fresh.length, errors: fresh.filter((n) => n.tone === 'error').length };
}

/** Whether an action still applies (no predicate: it does). */
export function applies(action: ToastAction): boolean {
  try {
    return action.available?.() ?? true;
  } catch {
    return false;
  }
}
