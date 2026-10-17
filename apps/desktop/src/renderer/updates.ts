/**
 * The desktop's `Platform.updates` (P6-01 slice 4, ADR-0075's amendment): the
 * web's update seam over main's `update:status`. `store.waiting` follows the
 * `ready` state, so the shell's `useUpdateNotice` shows the same toast as on the
 * web with a Restart button; `apply()` (called after `saveEverything()`, as on
 * the web) sends `update:apply`, which main refuses unless the update is
 * downloaded.
 *
 * What only the desktop has is said here, through the page's notifications:
 * the notify-only platforms' "Extrudo 0.5.0 is available." with the release
 * page (once per version per session), a failed check as a quiet notification,
 * and Check for Updates…'s "Extrudo is up to date.". The app menu's strip reads
 * `check` (ADR-0090 §1).
 */
import {
  type Push,
  RESTART_ACTION,
  showUpdateAvailable,
  showUpdateError,
} from '@extrudo/web/platform/updateNotice';
import {
  createUpdateStore,
  type PlatformUpdates,
  type UpdateState,
} from '@extrudo/web/platform/updates';
import type { ExtrudoApi, UpdateStatus } from '../shared/ipc';

export function desktopUpdates(api: ExtrudoApi, push: Push): PlatformUpdates {
  const store = createUpdateStore();
  /** The versions whose notify toast this session already showed. */
  const notified = new Set<string>();

  /** The app menu's strip (ADR-0090 §1): a check running, or one that found nothing newer. */
  let check: UpdateState['check'];
  const onStatus = (status: UpdateStatus) => {
    if (
      status.state === 'checking' ||
      status.state === 'available' ||
      status.state === 'downloading'
    ) {
      check = 'checking';
    } else if (status.state === 'idle') {
      // Idle after a check (or a manual check's answer): nothing newer. Idle at start: no check yet.
      if (check === 'checking' || status.message) check = 'current';
    } else {
      check = undefined;
    }
    const next: UpdateState = { waiting: status.state === 'ready' };
    if (status.state === 'ready' && status.version) next.version = status.version;
    if (check) next.check = check;
    store.setState(next, true);

    if (status.state === 'notify') {
      const key = status.version ?? '';
      if (notified.has(key)) return;
      notified.add(key);
      showUpdateAvailable({
        ...(status.version && { version: status.version }),
        openRelease: () => api.updates.openRelease(),
        push,
      });
    } else if (status.state === 'error') {
      // A manual check's error is shown; an automatic one is history only.
      showUpdateError({
        ...(status.message && { message: status.message }),
        ...(status.manual && { quiet: false }),
        push,
      });
    } else if (status.state === 'idle' && status.message) {
      // Only a manual check's answer carries a message ("Extrudo is up to date.").
      push(status.tone === 'info' ? 'info' : 'success', status.message);
    }
  };
  api.updates.onStatus(onStatus);

  return {
    store,
    action: RESTART_ACTION,
    check: () => api.updates.check(),
    async apply() {
      if (!store.getState().waiting) return false;
      api.updates.apply();
      return true;
    },
  };
}
