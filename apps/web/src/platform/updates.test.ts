import { describe, expect, it, vi } from 'vitest';
import {
  type ContainerLike,
  createUpdates,
  type RegistrationLike,
  UPDATE_CHECK_MS,
} from './updates';

type Listener = () => void;

function worker(state = 'installing') {
  const listeners: Listener[] = [];
  return {
    state,
    postMessage: vi.fn(),
    addEventListener: (_: 'statechange', l: Listener) => void listeners.push(l),
    fire(next: string) {
      this.state = next;
      for (const l of listeners) l();
    },
  };
}

function setup(controller: unknown = {}) {
  const regListeners: Listener[] = [];
  const ctrlListeners: Listener[] = [];
  const registration = {
    waiting: null as ReturnType<typeof worker> | null,
    installing: null as ReturnType<typeof worker> | null,
    addEventListener: (_: 'updatefound', l: Listener) => void regListeners.push(l),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const container: ContainerLike & { controller: unknown } = {
    controller,
    addEventListener: (_: 'controllerchange', l: Listener) => void ctrlListeners.push(l),
  };
  let tick: () => void = () => {};
  const reload = vi.fn();
  const updates = createUpdates({
    reload,
    schedule: (check) => {
      tick = check;
    },
    takeoverTimeoutMs: 50,
  });
  updates.watch(registration as RegistrationLike, container);
  return {
    updates,
    registration,
    container,
    reload,
    tick: () => tick(),
    /** The browser found a new sw.js, installed it, and it waits. */
    update() {
      const w = worker();
      registration.installing = w;
      for (const l of regListeners) l();
      registration.installing = null;
      registration.waiting = w;
      w.fire('installed');
      return w;
    },
    takeOver: () => {
      for (const l of ctrlListeners) l();
    },
  };
}

describe('updates', () => {
  it('starts without an update', () => {
    expect(setup().updates.store.getState().waiting).toBe(false);
  });

  it('notices a new worker that finished installing and waits', () => {
    const s = setup();
    s.update();
    expect(s.updates.store.getState().waiting).toBe(true);
  });

  it('notices an update that was already waiting when the page opened', () => {
    const w = worker('installed');
    const registration = {
      waiting: w,
      installing: null,
      addEventListener: () => {},
      update: () => Promise.resolve(),
    };
    const updates = createUpdates({ reload: () => {}, schedule: () => {} });
    updates.watch(registration, { controller: {}, addEventListener: () => {} });
    expect(updates.store.getState().waiting).toBe(true);
  });

  it('does not call the first install an update (nothing controls the page yet)', () => {
    const s = setup(null);
    s.update();
    expect(s.updates.store.getState().waiting).toBe(false);
  });

  it('asks the host for a new worker on its schedule', () => {
    const s = setup();
    s.tick();
    expect(s.registration.update).toHaveBeenCalledTimes(1);
    expect(UPDATE_CHECK_MS).toBe(3_600_000);
  });

  it('survives a failed update check', async () => {
    const s = setup();
    s.registration.update.mockRejectedValue(new Error('offline'));
    s.tick();
    await Promise.resolve();
    expect(s.updates.store.getState().waiting).toBe(false);
  });

  it('applies: tells the waiting worker to take over, reloads once it has', async () => {
    const s = setup();
    const w = s.update();
    const applied = s.updates.apply();
    expect(w.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(s.reload).not.toHaveBeenCalled();
    s.takeOver();
    expect(await applied).toBe(true);
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads anyway when the takeover never arrives', async () => {
    const s = setup();
    s.update();
    expect(await s.updates.apply()).toBe(true);
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no update waits', async () => {
    const s = setup();
    expect(await s.updates.apply()).toBe(false);
    expect(s.reload).not.toHaveBeenCalled();
  });

  it('forgets a waiting update that someone else already applied', async () => {
    const s = setup();
    s.update();
    s.registration.waiting = null;
    expect(await s.updates.apply()).toBe(false);
    expect(s.updates.store.getState().waiting).toBe(false);
  });
});
