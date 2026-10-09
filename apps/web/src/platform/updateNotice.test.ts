import { describe, expect, it, vi } from 'vitest';
import { createNotifications } from '../design-system/notifications';
import {
  reloadForUpdate,
  showUpdateAvailable,
  showUpdateError,
  showUpdateReady,
  UPDATE_READY_TEXT,
  UPDATE_TOAST_MS,
  UPDATE_UNSAVED_RESTART_TEXT,
  UPDATE_UNSAVED_TEXT,
} from './updateNotice';
import { createUpdates } from './updates';

function setup(saved: boolean | Error = true) {
  const notifications = createNotifications({ later: () => {} });
  const updates = createUpdates({ reload: vi.fn(), schedule: () => {} });
  const apply = vi.spyOn(updates, 'apply').mockResolvedValue(true);
  const saveEverything = vi.fn(async () => {
    if (saved instanceof Error) throw saved;
    return saved;
  });
  const deps = {
    updates,
    saveEverything,
    push: notifications.getState().push,
  };
  return { notifications, updates, apply, saveEverything, deps };
}

describe('the update toast', () => {
  it('says a new version is ready, with a Reload button', () => {
    const { notifications, deps } = setup();
    showUpdateReady(deps);
    const [toast] = notifications.getState().toasts;
    expect(toast?.text).toBe(UPDATE_READY_TEXT);
    expect(toast?.tone).toBe('info');
    expect(toast?.action?.label).toBe('Reload');
    // Long enough to read it while working.
    expect(toast?.lifetime).toBeGreaterThanOrEqual(30_000);
  });

  it('Reload saves every open design first, then applies the update', async () => {
    const { notifications, deps, saveEverything, apply } = setup();
    showUpdateReady(deps);
    notifications.getState().toasts[0]?.action?.run();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(saveEverything).toHaveBeenCalledBefore(apply);
  });

  it('never reloads over unsaved work: a failed save says so and stops', async () => {
    const { notifications, deps, apply } = setup(false);
    expect(await reloadForUpdate(deps)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    const [error] = notifications.getState().toasts;
    expect(error?.tone).toBe('error');
    expect(error?.text).toBe(UPDATE_UNSAVED_TEXT);
  });

  it('treats a save that throws like one that failed', async () => {
    const { deps, apply } = setup(new Error('storage gone'));
    expect(await reloadForUpdate(deps)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('is available only while an update still waits (the history greys it otherwise)', () => {
    const { notifications, updates, deps } = setup();
    showUpdateReady(deps);
    const action = notifications.getState().history[0]?.action;
    expect(action?.available?.()).toBe(false);
    updates.store.setState({ waiting: true });
    expect(action?.available?.()).toBe(true);
  });
});

describe('the desktop update toasts (P6-01 slice 4)', () => {
  it('a platform with a Restart action and a version says both', async () => {
    const { notifications, deps, apply, saveEverything } = setup();
    const updates = Object.assign(deps.updates, { action: 'Restart' });
    updates.store.setState({ waiting: true, version: '0.5.0' });
    showUpdateReady({ ...deps, updates });
    const [toast] = notifications.getState().toasts;
    expect(toast?.text).toBe('Extrudo 0.5.0 is ready.');
    expect(toast?.action?.label).toBe('Restart');
    toast?.action?.run();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(saveEverything).toHaveBeenCalledBefore(apply);
  });

  it("a failed save before a restart says it didn't restart", async () => {
    const { notifications, deps, apply } = setup(false);
    const updates = Object.assign(deps.updates, { action: 'Restart' });
    expect(await reloadForUpdate({ ...deps, updates })).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(notifications.getState().toasts[0]?.text).toBe(UPDATE_UNSAVED_RESTART_TEXT);
  });

  it('the notify-only toast names the version and opens the release page', () => {
    const notifications = createNotifications({ later: () => {} });
    const openRelease = vi.fn();
    showUpdateAvailable({ version: '0.5.0', openRelease, push: notifications.getState().push });
    const [toast] = notifications.getState().toasts;
    expect(toast?.text).toBe('Extrudo 0.5.0 is available.');
    expect(toast?.tone).toBe('info');
    expect(toast?.lifetime).toBe(UPDATE_TOAST_MS);
    expect(toast?.action?.label).toBe('Open the release page');
    toast?.action?.run();
    expect(openRelease).toHaveBeenCalledOnce();
  });

  it('a failed check goes to the history only', () => {
    const notifications = createNotifications({ later: () => {} });
    showUpdateError({ message: 'offline', push: notifications.getState().push });
    expect(notifications.getState().toasts).toEqual([]);
    expect(notifications.getState().history[0]?.text).toBe("Couldn't check for updates: offline");
  });

  it('trims what it is given: the first line, at most 140 characters', () => {
    const notifications = createNotifications({ later: () => {} });
    const push = notifications.getState().push;
    showUpdateError({ message: `HttpError: 406\nHeaders: {\n "server": "GitHub.com"\n}`, push });
    showUpdateError({ message: 'x'.repeat(400), push });
    showUpdateError({ push });
    const texts = notifications.getState().history.map((h) => h.text);
    expect(texts).toContain("Couldn't check for updates: HttpError: 406");
    expect(texts).toContain("Couldn't check for updates.");
    expect(texts.every((t) => !t.includes('Headers') && t.length <= 180)).toBe(true);
  });

  it('keeps a message that already says it, and shows a manual check’s error', () => {
    const notifications = createNotifications({ later: () => {} });
    showUpdateError({
      message: "Couldn't check for updates: you seem to be offline.",
      quiet: false,
      push: notifications.getState().push,
    });
    expect(notifications.getState().toasts[0]?.text).toBe(
      "Couldn't check for updates: you seem to be offline.",
    );
  });
});
