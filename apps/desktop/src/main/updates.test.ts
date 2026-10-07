import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../shared/ipc';
import {
  CHECK_EVERY_MS,
  createUpdates,
  FIRST_CHECK_MS,
  FOCUS_CHECK_AFTER_MS,
  MANUAL_ANSWER_MS,
  releasePage,
  selfUpdating,
  UP_TO_DATE_TEXT,
  type UpdaterLike,
  type UpdatesOptions,
} from './updates';

/** An `AppUpdater`-like fake: an emitter whose calls are spies. */
class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  checkForUpdates = vi.fn(async () => undefined as unknown);
  downloadUpdate = vi.fn(async () => undefined as unknown);
  quitAndInstall = vi.fn();
}

function setup(over: Partial<UpdatesOptions> = {}) {
  const updater = new FakeUpdater();
  const sent: UpdateStatus[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const make = vi.fn(() => updater as unknown as UpdaterLike);
  const updates = createUpdates({
    updater: make,
    platform: 'win32',
    isAppImage: false,
    packaged: true,
    disabled: false,
    send: (status) => sent.push(status),
    log,
    now: () => Date.now(),
    ...over,
  });
  return { updater, updates, sent, log, make };
}

describe('auto-update in main (P6-01 slice 4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('knows which installs update themselves', () => {
    expect(selfUpdating('win32', false)).toBe(true);
    expect(selfUpdating('linux', true)).toBe(true);
    expect(selfUpdating('linux', false)).toBe(false);
    expect(selfUpdating('darwin', false)).toBe(false);
  });

  it('builds the release page from the tag, never anything else', () => {
    expect(releasePage('0.5.0')).toBe('https://github.com/zoltanf/extrudo/releases/tag/v0.5.0');
    expect(releasePage('0.5.0/../../evil')).toBe(
      'https://github.com/zoltanf/extrudo/releases/latest',
    );
    expect(releasePage(undefined)).toBe('https://github.com/zoltanf/extrudo/releases/latest');
  });

  it('stays off in a dev run and with EXTRUDO_DISABLE_UPDATES', () => {
    const dev = setup({ packaged: false });
    expect(dev.updates.start()).toBe(false);
    expect(dev.make).not.toHaveBeenCalled();
    expect(dev.updates.running).toBe(false);
    const off = setup({ disabled: true });
    expect(off.updates.start()).toBe(false);
    expect(off.make).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CHECK_EVERY_MS * 2);
    off.updates.check();
    expect(off.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('configures the updater: downloads and installs on quit, no prereleases', () => {
    const { updater, updates } = setup();
    expect(updates.start()).toBe(true);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.allowPrerelease).toBe(false);
  });

  it('checks 10 s after start, every six hours, and on focus after an hour', () => {
    const { updater, updates } = setup();
    updates.start();
    vi.advanceTimersByTime(FIRST_CHECK_MS - 1);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    // A focus soon after the check doesn't ask again.
    vi.advanceTimersByTime(FOCUS_CHECK_AFTER_MS - FIRST_CHECK_MS);
    updates.focused();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FIRST_CHECK_MS + 1);
    updates.focused();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(CHECK_EVERY_MS - FOCUS_CHECK_AFTER_MS - FIRST_CHECK_MS - 1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
    updates.dispose();
    vi.advanceTimersByTime(CHECK_EVERY_MS * 3);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('reports checking, available, downloading and ready, and applies only when ready', () => {
    const { updater, updates, sent, log } = setup();
    updates.start();
    expect(updates.apply()).toBe(false);
    expect(log.warn).toHaveBeenCalledWith('Refusing to install an update in state "idle".');
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.5.0' });
    updater.emit('download-progress', { percent: 41.6 });
    expect(updates.apply()).toBe(false);
    updater.emit('update-downloaded', { version: '0.5.0' });
    expect(sent).toEqual([
      { state: 'checking' },
      { state: 'available', version: '0.5.0' },
      { state: 'downloading', version: '0.5.0', percent: 42 },
      { state: 'ready', version: '0.5.0' },
    ]);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updates.apply()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    // `autoDownload` does the download; we never call it ourselves.
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('a ready update is not checked or downloaded again', () => {
    const { updater, updates } = setup();
    updates.start();
    updater.emit('update-downloaded', { version: '0.5.0' });
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    updates.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it.each([
    ['a deb install', 'linux' as const],
    ['macOS (unsigned)', 'darwin' as const],
  ])('only notifies on %s: no download, no install', (_name, platform) => {
    const { updater, updates, sent } = setup({ platform, isAppImage: false });
    updates.start();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.5.0' });
    // The same version again (the next check) says nothing new.
    updater.emit('update-available', { version: '0.5.0' });
    updater.emit('download-progress', { percent: 50 });
    updater.emit('update-downloaded', { version: '0.5.0' });
    expect(sent).toEqual([
      { state: 'checking' },
      {
        state: 'notify',
        version: '0.5.0',
        url: 'https://github.com/zoltanf/extrudo/releases/tag/v0.5.0',
      },
    ]);
    expect(updates.releaseUrl()).toBe('https://github.com/zoltanf/extrudo/releases/tag/v0.5.0');
    expect(updates.apply()).toBe(false);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('an AppImage updates itself', () => {
    const { updater, updates } = setup({ platform: 'linux', isAppImage: true });
    updates.start();
    expect(updater.autoDownload).toBe(true);
  });

  it('says "up to date" after a manual check within a minute, not after a background one', () => {
    const { updater, updates, sent } = setup();
    updates.start();
    vi.advanceTimersByTime(FIRST_CHECK_MS);
    updater.emit('update-not-available', { version: '0.4.0' });
    expect(sent.at(-1)).toEqual({ state: 'idle' });

    updates.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.emit('update-not-available', { version: '0.4.0' });
    expect(sent.at(-1)).toEqual({ state: 'idle', message: UP_TO_DATE_TEXT });

    // An answer that comes after the minute is a background one.
    updates.check();
    vi.advanceTimersByTime(MANUAL_ANSWER_MS + 1);
    updater.emit('update-not-available', { version: '0.4.0' });
    expect(sent.at(-1)).toEqual({ state: 'idle' });
  });

  it('catches, logs and reports every updater error once, and never throws', async () => {
    const { updater, updates, sent, log } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'));
    updates.start();
    vi.advanceTimersByTime(FIRST_CHECK_MS);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(sent).toEqual([{ state: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' }]);
    expect(log.error).toHaveBeenCalledTimes(2);

    updater.checkForUpdates.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => updates.check()).not.toThrow();
    expect(sent.at(-1)).toEqual({ state: 'error', message: 'boom' });

    updater.emit('update-downloaded', { version: '0.5.0' });
    updater.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('installer missing');
    });
    expect(updates.apply()).toBe(false);
    expect(sent.at(-1)).toEqual({ state: 'error', message: 'installer missing' });
  });

  it('reports a failure to create the updater instead of throwing', () => {
    const { updates, sent } = setup({
      updater: () => {
        throw new Error('no app-update.yml');
      },
    });
    expect(updates.start()).toBe(false);
    expect(sent).toEqual([{ state: 'error', message: 'no app-update.yml' }]);
  });
});
