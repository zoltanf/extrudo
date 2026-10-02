import { describe, expect, it, vi } from 'vitest';
import { createNotifications } from '../design-system/notifications';
import {
  reloadForUpdate,
  showUpdateReady,
  UPDATE_READY_TEXT,
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
