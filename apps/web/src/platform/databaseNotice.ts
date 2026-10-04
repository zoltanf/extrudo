/**
 * What this tab says when another tab holds the IndexedDB upgrade up, or when
 * another tab has already upgraded the database past it (the follow-up to
 * P4-09's database version 2). Storage hands `openDatabase` two callbacks and
 * no words; this is where they become toasts.
 *
 * The second one is the sharp edge of the File System Access/IndexedDB pair:
 * a tab holding a version-1 connection holds up a new tab's upgrade for ever,
 * so the *old* tab has to let go when it hears about the upgrade — which means
 * its design is saved and the user told, because after that its storage calls
 * fail. Pure logic over a push function and a save function, so the rules are
 * unit tests, like `updateNotice.ts`.
 */
import type { ToastOptions, ToastTone } from '../design-system/notifications';

export const BLOCKED_TEXT = "Close Extrudo's other tabs to finish updating.";
export const UPDATED_ELSEWHERE_TEXT =
  'Extrudo was updated in another tab. Reload this tab to keep working.';
/** What the storage says after that, instead of the browser's InvalidStateError. */
export const STORAGE_CLOSED_TEXT = UPDATED_ELSEWHERE_TEXT;
/** These stay up: nothing happens until the person acts or another tab lets go. */
export const DATABASE_TOAST_MS = 10 * 60_000;

/**
 * Shows a toast and answers its ID. The app's `Push` (what `useToasts` gives
 * the app) answers nothing, which is all a notice needs; `showBlocked` takes
 * this one so the waiting open can take its toast back.
 */
export type Push = (tone: ToastTone, text: string, options?: ToastOptions) => number;

export interface DatabaseNoticeDeps {
  /** As `showBlocked`'s, but the return value is ignored here. */
  push: Push;
  /** Saves every open design; false when something stayed unsaved. */
  saveEverything(): Promise<boolean>;
  reload(): void;
  /** Says the save didn't work, as the update notice does (ADR-0054). */
  unsaved(): void;
}

/**
 * Another tab holds the database back, so opening it is waiting. Returns the
 * toast's ID, so the caller can take it back when the open finally succeeds.
 */
export function showBlocked(push: Push): number {
  return push('info', BLOCKED_TEXT, { lifetime: DATABASE_TOAST_MS });
}

/**
 * Another tab upgraded the database, so this one is closed and its storage is
 * gone until it reloads. Saving starts here (the connection closes
 * synchronously after this is called, so what a save can still finish, it
 * finishes); the reload button saves again first, and refuses when a save
 * fails, because reloading would throw unsaved work away.
 */
export function showUpdatedElsewhere({
  push,
  saveEverything,
  reload,
  unsaved,
}: DatabaseNoticeDeps): void {
  void saveEverything();
  push('info', UPDATED_ELSEWHERE_TEXT, {
    lifetime: DATABASE_TOAST_MS,
    action: {
      label: 'Reload',
      run: () => {
        void (async () => {
          const saved = await saveEverything().catch(() => false);
          if (!saved) return unsaved();
          reload();
        })();
      },
    },
  });
}

/**
 * Whether an error is the browser's own "the connection is closing" one, which
 * is the only thing this wrapper replaces: every other message (a damaged
 * archive, a project that isn't there, a full disk) is more use than ours.
 */
function closedConnection(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'InvalidStateError';
}

/**
 * A project store that says what happened instead of the browser's
 * `InvalidStateError` once its connection is closed, so the save status and
 * the error toasts read like the app rather than like a browser API. Only the
 * closed-connection error changes; the store is the one behind it.
 */
export function closedStorage<T extends object>(store: T, message: string): T {
  const readable = (error: unknown): never => {
    throw closedConnection(error) ? new Error(message, { cause: error }) : error;
  };
  return new Proxy(store, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        let result: unknown;
        try {
          result = (value as (...a: unknown[]) => unknown).apply(target, args);
        } catch (error) {
          return readable(error);
        }
        return result instanceof Promise ? result.catch(readable) : result;
      };
    },
  });
}
