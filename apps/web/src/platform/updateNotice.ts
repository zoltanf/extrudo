/**
 * The toast for a waiting update (ADR-0054): "A new version of Extrudo is
 * ready." with a Reload button (on the desktop "Extrudo 0.5.0 is ready." with
 * Restart, P6-01 slice 4). Pure logic over a push function, the update
 * state and a save function, so the rules are unit tests: the button saves
 * every open design first and does **not** reload when a save fails; it is
 * only offered while an update still waits (the history disables it
 * otherwise, ADR-0041).
 */
import type { ToastOptions, ToastTone } from '../design-system/notifications';
import type { PlatformUpdates } from './updates';

export const UPDATE_READY_TEXT = 'A new version of Extrudo is ready.';
export const UPDATE_UNSAVED_TEXT =
  "Your changes couldn't be saved, so Extrudo didn't reload. Fix the save problem first (the save status says what it is).";
/** The desktop's (P6-01 slice 4): its button restarts rather than reloads. */
export const UPDATE_UNSAVED_RESTART_TEXT =
  "Your changes couldn't be saved, so Extrudo didn't restart. Fix the save problem first (the save status says what it is).";
/** The web's button; the desktop passes "Restart". */
export const RELOAD_ACTION = 'Reload';
export const RESTART_ACTION = 'Restart';

/** The ready toast's text: the version where the platform knows it. */
export const updateReadyText = (version?: string) =>
  version ? `Extrudo ${version} is ready.` : UPDATE_READY_TEXT;
/** The toast stays long: nobody should be hurried into a reload. */
export const UPDATE_TOAST_MS = 30_000;

export type Push = (tone: ToastTone, text: string, options?: ToastOptions) => void;

export interface UpdateNoticeDeps {
  updates: PlatformUpdates;
  /** Saves every open design; false when something stayed unsaved. */
  saveEverything(): Promise<boolean>;
  push: Push;
}

/** Shows the toast (call it when `updates.store`'s `waiting` turns true). */
export function showUpdateReady({ updates, saveEverything, push }: UpdateNoticeDeps): void {
  push('info', updateReadyText(updates.store.getState().version), {
    lifetime: UPDATE_TOAST_MS,
    action: {
      label: updates.action ?? RELOAD_ACTION,
      available: () => updates.store.getState().waiting,
      run: () => {
        void reloadForUpdate({ updates, saveEverything, push });
      },
    },
  });
}

/** Saves, then lets the new version take over and reloads. Returns whether it reloaded. */
export async function reloadForUpdate({
  updates,
  saveEverything,
  push,
}: UpdateNoticeDeps): Promise<boolean> {
  let saved = false;
  try {
    saved = await saveEverything();
  } catch {
    saved = false;
  }
  if (!saved) {
    push(
      'error',
      updates.action === RESTART_ACTION ? UPDATE_UNSAVED_RESTART_TEXT : UPDATE_UNSAVED_TEXT,
    );
    return false;
  }
  return updates.apply();
}

/** The desktop's notify-only toast (P6-01 slice 4): a deb install or macOS before signing. */
export const updateAvailableText = (version?: string) =>
  version ? `Extrudo ${version} is available.` : 'A new version of Extrudo is available.';
export const OPEN_RELEASE_ACTION = 'Open the release page';

/**
 * Where the desktop can't update itself it only says a version is out, with a
 * button to its release page (main opens the URL it built; nothing is passed
 * from here). Shown once per version per session by the caller.
 */
export function showUpdateAvailable({
  version,
  openRelease,
  push,
}: {
  version?: string;
  openRelease(): void;
  push: Push;
}): void {
  push('info', updateAvailableText(version), {
    lifetime: UPDATE_TOAST_MS,
    action: { label: OPEN_RELEASE_ACTION, run: openRelease },
  });
}

/** The longest piece of a failure's own text a toast shows (the first line only). */
const MAX_FAILURE_LINE = 140;
const CHECK_FAILED = "Couldn't check for updates";

/**
 * An update check that failed: history only unless `quiet` is false (a manual
 * check). The text is trimmed here too, whoever sends it: its first line and
 * at most 140 characters, so a response's headers or body never reach a person
 * (ADR-0075's 2026-10-09 amendment). A message that already starts with the
 * sentence ("Couldn't check for updates: you seem to be offline.") is used as
 * it is.
 */
export function showUpdateError({
  message,
  quiet = true,
  push,
}: {
  message?: string;
  quiet?: boolean;
  push: Push;
}): void {
  const line =
    message
      ?.split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? '';
  const cut = line.length > MAX_FAILURE_LINE ? `${line.slice(0, MAX_FAILURE_LINE - 1)}…` : line;
  const text = !cut
    ? `${CHECK_FAILED}.`
    : cut.startsWith(CHECK_FAILED)
      ? cut
      : `${CHECK_FAILED}: ${cut}`;
  push('error', text, quiet ? { quiet: true } : {});
}
