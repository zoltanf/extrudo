/**
 * "A new version is ready" (a platform interface, ADR-0054; the open item of
 * ADR-0037). The service worker installs an update in the background and then
 * waits: it takes over only when the page sends it `SKIP_WAITING`, so a design
 * is never swapped under someone who is working. This module watches the
 * registration, keeps one bit of state (is an update waiting?) and applies it
 * on request. No React and no DOM beyond the service worker types, so it runs
 * in Node tests with fakes.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface UpdateState {
  /** A newer service worker is installed and waiting to take over. */
  waiting: boolean;
}

export type UpdateStore = StoreApi<UpdateState>;

interface WorkerLike {
  readonly state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
}

/** The parts of `ServiceWorkerRegistration` the watcher uses. */
export interface RegistrationLike {
  readonly waiting: { postMessage(message: unknown): void } | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
  update(): Promise<unknown>;
}

/** The parts of `ServiceWorkerContainer` the watcher uses. */
export interface ContainerLike {
  /** The worker controlling this page: none on a first visit, when nothing can be "an update". */
  readonly controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface UpdateEnv {
  reload(): void;
  /** Runs `check` now and then while the page lives: a design stays open for hours. */
  schedule(check: () => void): void;
  /** Waits this long for the new worker to take over before reloading anyway. */
  takeoverTimeoutMs?: number;
}

/** How often an open page asks the host for a new `sw.js` (the browser itself only does so on navigation). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

export interface Updates {
  readonly store: UpdateStore;
  /** Starts watching a registration (called once it exists). */
  watch(registration: RegistrationLike, container: ContainerLike): void;
  /**
   * Lets the waiting worker take over, then reloads. False when nothing waits (the
   * caller then does nothing). Callers save the design first.
   */
  apply(): Promise<boolean>;
}

export function createUpdates(env: UpdateEnv): Updates {
  const store = createStore<UpdateState>(() => ({ waiting: false }));
  let current: { registration: RegistrationLike; container: ContainerLike } | undefined;

  const check = () => {
    if (!current) return;
    const { registration, container } = current;
    store.setState({ waiting: !!container.controller && !!registration.waiting });
  };

  return {
    store,
    watch(registration, container) {
      current = { registration, container };
      check();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') check();
        });
      });
      env.schedule(() => {
        registration.update().catch(() => {});
        check();
      });
    },
    async apply() {
      if (!current) return false;
      const { registration, container } = current;
      const worker = registration.waiting;
      if (!worker) {
        check();
        return false;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, env.takeoverTimeoutMs ?? 4000);
        container.addEventListener('controllerchange', () => {
          clearTimeout(timer);
          resolve();
        });
        worker.postMessage({ type: 'SKIP_WAITING' });
      });
      env.reload();
      return true;
    },
  };
}

/** The page's updates: the browser's reload and an hourly check (and one when the tab comes back). */
export const appUpdates: Updates = createUpdates({
  reload: () => globalThis.location.reload(),
  schedule(check) {
    setInterval(check, UPDATE_CHECK_MS);
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});
