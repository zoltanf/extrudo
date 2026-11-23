import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  type ContainerLike,
  createUpdates,
  entryScript,
  PRECACHE,
  PRECACHE_INDEX,
  type RegistrationLike,
  UPDATE_CHECK_MS,
} from './updates';

type Listener = () => void;

/** Lets the update check (async: it may look at the cache) finish. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

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

/**
 * `older`: what the page's own build says against the precached index.html (`pageIsOlder`);
 * left out, the env has no such check (a waiting worker alone means an update).
 */
function setup(controller: unknown = {}, older?: { value: boolean | undefined }) {
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
    ...(older && { pageIsOlder: async () => older.value }),
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
  it('starts without an update', async () => {
    const s = setup();
    await settled();
    expect(s.updates.store.getState().waiting).toBe(false);
  });

  it('notices a new worker that finished installing and waits', async () => {
    const s = setup();
    s.update();
    await settled();
    expect(s.updates.store.getState().waiting).toBe(true);
  });

  it('notices an update that was already waiting when the page opened', async () => {
    const w = worker('installed');
    const registration = {
      waiting: w,
      installing: null,
      addEventListener: () => {},
      update: () => Promise.resolve(),
    };
    const updates = createUpdates({ reload: () => {}, schedule: () => {} });
    updates.watch(registration, { controller: {}, addEventListener: () => {} });
    await settled();
    expect(updates.store.getState().waiting).toBe(true);
  });

  it('does not call the first install an update (nothing controls the page yet)', async () => {
    const s = setup(null);
    s.update();
    await settled();
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
    await settled();
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

  // Issue #273: installing rewrote the index.html the old worker serves, so a reload ran the
  // new version while its worker waited, and every load said "Update ready" again.
  describe('a page that already runs the waiting version', () => {
    it('lets the worker take over quietly: no update, no reload', async () => {
      const s = setup({}, { value: false });
      const w = s.update();
      await settled();
      expect(w.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      expect(s.updates.store.getState().waiting).toBe(false);
      expect(s.reload).not.toHaveBeenCalled();
    });

    it('still offers an update the page does not run yet', async () => {
      const s = setup({}, { value: true });
      const w = s.update();
      await settled();
      expect(w.postMessage).not.toHaveBeenCalled();
      expect(s.updates.store.getState().waiting).toBe(true);
    });

    it('offers it, as before, when the page cannot tell', async () => {
      const s = setup({}, { value: undefined });
      const w = s.update();
      await settled();
      expect(w.postMessage).not.toHaveBeenCalled();
      expect(s.updates.store.getState().waiting).toBe(true);
    });

    it('never on a first visit (no controller)', async () => {
      const s = setup(null, { value: false });
      const w = s.update();
      await settled();
      expect(w.postMessage).not.toHaveBeenCalled();
    });
  });

  // Another tab opened on the new version and let its worker in: this one still runs the old one.
  describe('a newer version that another tab let take over', () => {
    it('is an update here, and Reload only reloads', async () => {
      const older = { value: false as boolean | undefined };
      const s = setup({}, older);
      await settled();
      expect(s.updates.store.getState().waiting).toBe(false);
      older.value = true;
      s.takeOver();
      await settled();
      expect(s.updates.store.getState().waiting).toBe(true);
      expect(await s.updates.apply()).toBe(true);
      expect(s.reload).toHaveBeenCalledTimes(1);
    });

    it('is not one while a worker still installs', async () => {
      const s = setup({}, { value: true });
      s.registration.installing = worker();
      s.tick();
      await settled();
      expect(s.updates.store.getState().waiting).toBe(false);
    });
  });

  describe('entryScript', () => {
    const base = 'https://app.example/sub/index.html';

    it("finds Vite's entry, resolved against the page", () => {
      const html = `<head><script>var x</script>
        <script type="module" crossorigin src="./assets/index-1kajCuvk.js"></script></head>`;
      expect(entryScript(html, base)).toBe('https://app.example/sub/assets/index-1kajCuvk.js');
    });

    it('reads unquoted attributes and keeps a query', () => {
      expect(entryScript('<script src=/a.js?v=2 type=module></script>', base)).toBe(
        'https://app.example/a.js?v=2',
      );
    });

    it('has none without a module script', () => {
      expect(
        entryScript('<script src="./a.js"></script><script type="module">1</script>', base),
      ).toBe(undefined);
    });
  });

  it('looks where sw.js keeps the page', () => {
    const sw = readFileSync(new URL('../../pwa/sw.js', import.meta.url), 'utf8');
    expect(sw).toContain(`const CACHE = '${PRECACHE}';`);
    expect(sw).toContain(`const INDEX = '${PRECACHE_INDEX}';`);
  });
});
