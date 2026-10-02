/**
 * The toast for a waiting update (ADR-0054): "A new version of Extrudo is
 * ready." with a Reload button. Pure logic over a push function, the update
 * state and a save function, so the rules are unit tests: the button saves
 * every open design first and does **not** reload when a save fails; it is
 * only offered while an update still waits (the history disables it
 * otherwise, ADR-0041).
 */
import type { ToastOptions, ToastTone } from '../design-system/notifications';
import type { Updates } from './updates';

export const UPDATE_READY_TEXT = 'A new version of Extrudo is ready.';
export const UPDATE_UNSAVED_TEXT =
  "Your changes couldn't be saved, so Extrudo didn't reload. Fix the save problem first (the save status says what it is).";
/** The toast stays long: nobody should be hurried into a reload. */
export const UPDATE_TOAST_MS = 30_000;

export type Push = (tone: ToastTone, text: string, options?: ToastOptions) => void;

export interface UpdateNoticeDeps {
  updates: Pick<Updates, 'store' | 'apply'>;
  /** Saves every open design; false when something stayed unsaved. */
  saveEverything(): Promise<boolean>;
  push: Push;
}

/** Shows the toast (call it when `updates.store`'s `waiting` turns true). */
export function showUpdateReady({ updates, saveEverything, push }: UpdateNoticeDeps): void {
  push('info', UPDATE_READY_TEXT, {
    lifetime: UPDATE_TOAST_MS,
    action: {
      label: 'Reload',
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
    push('error', UPDATE_UNSAVED_TEXT);
    return false;
  }
  return updates.apply();
}
