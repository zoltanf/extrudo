/**
 * Auto-update in main (P6-01 slice 4, ADR-0075's amendment). `electron-updater`
 * checks the **published** GitHub releases of the repository the builder config
 * names (a draft is invisible to it, so publishing the release is what ships an
 * update) and reports to the renderer over one channel, `update:status`.
 *
 * Linux AppImage and Windows NSIS update themselves: the update downloads in
 * the background and installs when the app quits, or at once when the person
 * presses Restart (the renderer saves everything first, then sends
 * `update:apply`). A deb install belongs to the package manager and an unsigned
 * macOS app is refused by Squirrel.Mac, so there the updater only *checks* and
 * the renderer offers the release page (`notify`); nothing is downloaded.
 *
 * Pure over an injected `UpdaterLike` (the slice of `AppUpdater` used here), so
 * `updates.test.ts` drives it with a fake emitter and fake timers. Every updater
 * error is caught, logged and reported, never thrown: an update check must not
 * take the app down.
 */
import type { UpdateStatus } from '../shared/ipc';
import {
  classifyUpdateError,
  NO_RELEASE_TEXT,
  OFFLINE_TEXT,
  otherFailureText,
} from './updateErrors';

/** The repository the releases live in (`electron-builder.yml`'s `publish`). */
export const UPDATE_REPOSITORY = 'zoltanf/extrudo';
/** The first check waits this long after start, so it doesn't compete with the first open. */
export const FIRST_CHECK_MS = 10_000;
/** Then every six hours while the app runs. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
/** A window focus checks again when the last check is older than this. */
export const FOCUS_CHECK_AFTER_MS = 60 * 60 * 1000;
/** Help › Check for Updates… says "up to date" only for an answer within this long. */
export const MANUAL_ANSWER_MS = 60_000;
export const UP_TO_DATE_TEXT = 'Extrudo is up to date.';

/** The slice of `electron-updater`'s `AppUpdater` this module uses. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface UpdatesOptions {
  /** Called only from `start()`, so a dev run never constructs the real updater. */
  updater: () => UpdaterLike;
  platform: NodeJS.Platform;
  /** `process.env.APPIMAGE` is set (the AppImage runtime sets it). */
  isAppImage: boolean;
  /** `app.isPackaged`: a dev run has no `app-update.yml` and nothing to update. */
  packaged: boolean;
  /** `EXTRUDO_DISABLE_UPDATES` is set (the smoke test, a managed install). */
  disabled: boolean;
  send(status: UpdateStatus): void;
  log: Pick<Console, 'info' | 'warn' | 'error'>;
  now?: () => number;
}

export interface Updates {
  /** Starts the updater and its schedule; false when it doesn't run here. */
  start(): boolean;
  /** Whether `start()` started it (Help › Check for Updates… is enabled). */
  readonly running: boolean;
  /** Help › Check for Updates…: a check now, which answers "up to date" too. */
  check(): void;
  /** The window got focus: checks when the last check is over an hour old. */
  focused(): void;
  /** Quits and installs; refused unless an update is downloaded (`ready`). */
  apply(): boolean;
  /** The release page of the update `notify` reported, if any. */
  releaseUrl(): string | undefined;
  readonly status: UpdateStatus;
  dispose(): void;
}

/** Whether this install updates itself: an AppImage on Linux, NSIS on Windows. */
export function selfUpdating(platform: NodeJS.Platform, isAppImage: boolean): boolean {
  if (platform === 'win32') return true;
  if (platform === 'linux') return isAppImage;
  return false;
}

/**
 * The release page of a version, built from the repository and the tag (`v` +
 * the version), never from a URL in the manifest. A version that isn't plain
 * semver goes to the releases list instead.
 */
export function releasePage(version: string | undefined): string {
  const base = `https://github.com/${UPDATE_REPOSITORY}/releases`;
  return version && /^\d+\.\d+\.\d+$/.test(version) ? `${base}/tag/v${version}` : `${base}/latest`;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const versionOf = (info: unknown): string | undefined => {
  const version = (info as { version?: unknown } | undefined)?.version;
  return typeof version === 'string' ? version : undefined;
};

export function createUpdates(options: UpdatesOptions): Updates {
  const now = options.now ?? Date.now;
  const selfUpdates = selfUpdating(options.platform, options.isAppImage);
  let updater: UpdaterLike | undefined;
  let status: UpdateStatus = { state: 'idle' };
  let lastCheck = 0;
  /** A manual check's deadline: an "up to date" before it is said aloud. */
  let manualUntil = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let interval: ReturnType<typeof setInterval> | undefined;

  const report = (next: UpdateStatus) => {
    status = next;
    options.send(next);
  };

  /**
   * A failed check (ADR-0075's 2026-10-09 amendment). Only a manual check
   * answers when nothing is wrong with the app itself: no published release
   * yet and no network are normal states, said in a sentence by Help › Check
   * for Updates… and not at all by an automatic check. Anything else is
   * reported as the error's first line. The manual window closes with the
   * first answer: `checkForUpdates` rejects *and* the updater emits `error`,
   * and the second report of one failure is an automatic one.
   */
  const failed = (error: unknown, what: 'check' | 'install' = 'check') => {
    const kind = classifyUpdateError(error);
    options.log.error('Update check failed:', messageOf(error).split('\n')[0]);
    const manual = now() <= manualUntil;
    manualUntil = 0;
    if (kind !== 'other') {
      if (manual) {
        report(
          kind === 'no-release'
            ? { state: 'idle', message: NO_RELEASE_TEXT, tone: 'info' }
            : { state: 'error', message: OFFLINE_TEXT, manual: true },
        );
      } else if (status.state === 'checking') {
        // Not "checking" for ever: nothing to say, nothing to wait for.
        report({ state: 'idle' });
      }
      return;
    }
    const message = otherFailureText(
      error,
      what === 'install' ? "Couldn't install the update." : undefined,
    );
    if (status.state === 'error' && status.message === message) return;
    report({ state: 'error', message, ...(manual && { manual: true }) });
  };

  const runCheck = () => {
    if (!updater) return;
    // A downloaded update stays ready; checking again would only download it twice.
    if (status.state === 'ready' || status.state === 'downloading') return;
    lastCheck = now();
    try {
      updater.checkForUpdates().catch(failed);
    } catch (error) {
      failed(error);
    }
  };

  const listen = (target: UpdaterLike) => {
    target.on('checking-for-update', () => {
      if (status.state !== 'notify') report({ state: 'checking' });
    });
    target.on('update-available', (info: never) => {
      const version = versionOf(info);
      if (selfUpdates) {
        report({ state: 'available', ...(version && { version }) });
        return;
      }
      // Notify-only: the release page, once per version (main keeps the state).
      if (status.state === 'notify' && status.version === version) return;
      report({ state: 'notify', ...(version && { version }), url: releasePage(version) });
    });
    target.on('download-progress', (progress: never) => {
      if (!selfUpdates) return;
      const percent = (progress as { percent?: unknown }).percent;
      report({
        state: 'downloading',
        ...(status.version && { version: status.version }),
        ...(typeof percent === 'number' && { percent: Math.round(percent) }),
      });
    });
    target.on('update-downloaded', (info: never) => {
      if (!selfUpdates) return;
      const version = versionOf(info) ?? status.version;
      report({ state: 'ready', ...(version && { version }) });
    });
    target.on('update-not-available', () => {
      // A notify-only release page stays known; nothing newer replaced it.
      if (status.state === 'notify') return;
      if (now() <= manualUntil) {
        manualUntil = 0;
        report({ state: 'idle', message: UP_TO_DATE_TEXT });
      } else {
        report({ state: 'idle' });
      }
    });
    target.on('error', (error: never) => failed(error));
  };

  return {
    start() {
      if (updater) return true;
      if (!options.packaged || options.disabled) {
        options.log.info(
          options.disabled
            ? 'Updates are off (EXTRUDO_DISABLE_UPDATES).'
            : 'Updates are off: not a packaged build.',
        );
        return false;
      }
      try {
        updater = options.updater();
        updater.autoDownload = selfUpdates;
        updater.autoInstallOnAppQuit = selfUpdates;
        updater.allowPrerelease = false;
        listen(updater);
      } catch (error) {
        updater = undefined;
        failed(error);
        return false;
      }
      timers.push(setTimeout(runCheck, FIRST_CHECK_MS));
      interval = setInterval(runCheck, CHECK_EVERY_MS);
      return true;
    },
    get running() {
      return updater !== undefined;
    },
    check() {
      if (!updater) return;
      if (status.state === 'ready' || status.state === 'downloading' || status.state === 'notify') {
        // Already known: say it again rather than check.
        report(status);
        return;
      }
      manualUntil = now() + MANUAL_ANSWER_MS;
      runCheck();
    },
    focused() {
      if (updater && lastCheck > 0 && now() - lastCheck > FOCUS_CHECK_AFTER_MS) runCheck();
    },
    apply() {
      if (!updater || status.state !== 'ready' || !selfUpdates) {
        options.log.warn(`Refusing to install an update in state "${status.state}".`);
        return false;
      }
      try {
        updater.quitAndInstall();
        return true;
      } catch (error) {
        failed(error, 'install');
        return false;
      }
    },
    releaseUrl() {
      return status.state === 'notify' ? status.url : undefined;
    },
    get status() {
      return status;
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
      if (interval) clearInterval(interval);
      interval = undefined;
    },
  };
}
