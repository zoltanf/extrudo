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
   * (opening it, after an action ran, and on `recheck`: the app calls it when
   * the document changes, P3-17), so a stale button, one whose change is
   * undone or already made, shows disabled. Absent: always applies.
   */
  available?(): boolean;
}

/** What a toast can carry besides its text. */
export interface ToastOptions {
  action?: ToastAction;
  /**
   * Several buttons on one toast, for a message with more than one answer
   * (ADR-0065 §3's "Bracket.extrudo changed on disk." with "Load from disk"
   * and "Overwrite"). `action` is the first of them, so everything that reads
   * one button still works.
   */
  actions?: readonly ToastAction[];
  /** How long it stays, ms; errors stay until dismissed whatever this says. */
  lifetime?: number;
  /**
   * Only into the history, no toast (P3-13): for news the view already
   * shows in place, such as a recompute's error on its timeline chip. The
   * bell's badge still counts it.
   */
  quiet?: boolean;
}

/** The buttons a toast or a notification offers, however they were given. */
export function actionsOf(
  options: Pick<ToastOptions, 'action' | 'actions'>,
): readonly ToastAction[] {
  if (options.actions) return options.actions;
  return options.action ? [options.action] : [];
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
  /** The first button of the last occurrence, and all of them. */
  action?: ToastAction;
  actions?: readonly ToastAction[];
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
  /** Bumped by `recheck` while the panel is open: the panel asks `available()` again. */
  checks: number;
  /** Shows a toast (and records it); answers its ID, so it can be taken back. */
  push(tone: ToastTone, text: string, options?: ToastOptions): number;
  dismiss(id: number): void;
  setOpen(open: boolean): void;
  /** Forgets the history (the toasts on screen stay). */
  clear(): void;
  /**
   * Something the actions depend on changed (the document, P3-17): an open panel asks every
   * action's `available()` again. Nothing happens while the panel is closed (it asks when it
   * opens).
   */
  recheck(): void;
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
    checks: 0,
    push(tone, text, options = {}) {
      const id = nextToast++;
      const seq = get().seq + 1;
      const buttons = actionsOf(options);
      // `action` is the first button, so a reader that knows about one still works.
      const action = buttons.length > 0 ? { action: buttons[0], actions: buttons } : {};
      const toast: Toast = { id, tone, text, ...options, ...action };
      set((s) => ({
        seq,
        // Looking at the history counts as seeing what arrives while it's open.
        seen: s.open ? seq : s.seen,
        toasts: options.quiet ? s.toasts : [...s.toasts.slice(1 - TOAST_LIMIT), toast],
        history: record(
          s.history,
          { tone, text, at: now(), seq, actions: buttons },
          () => nextEntry++,
        ),
      }));
      if (tone !== 'error' && !options.quiet) {
        later(() => get().dismiss(id), options.lifetime ?? TOAST_LIFETIME_MS);
      }
      return id;
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
    recheck() {
      if (
        get().open &&
        get().history.some((n) => actionsOf(n).some((action) => action.available))
      ) {
        set((s) => ({ checks: s.checks + 1 }));
      }
    },
  }));
}

/**
 * The page's one store (ADR-0041: one per page, session only): what
 * `useToasts` draws, and what the app pushes to from outside React too — the
 * storage upgrade notices, which arrive before anything is mounted.
 */
export const appNotifications: NotificationStore = createNotifications();

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
    actions?: readonly ToastAction[] | undefined;
  },
  newId: () => number,
): Notification[] {
  const same = history.find((n) => n.tone === next.tone && n.text === next.text);
  const buttons = next.actions ?? [];
  const entry: Notification = {
    id: same?.id ?? newId(),
    tone: next.tone,
    text: next.text,
    at: next.at,
    seq: next.seq,
    count: (same?.count ?? 0) + 1,
    ...(buttons.length > 0 && { action: buttons[0], actions: buttons }),
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
