/**
 * "A new version is ready" (a platform interface, ADR-0054; the open item of
 * ADR-0037). The service worker installs an update in the background and then
 * waits: it takes over only when the page sends it `SKIP_WAITING`, so a design
 * is never swapped under someone who is working. This module watches the
 * registration, keeps one bit of state (is an update waiting?) and applies it
 * on request. No React and no DOM beyond the service worker types, so it runs
 * in Node tests with fakes (the page's own `appUpdates` at the end is the
 * exception).
 *
 * Installing a new worker rewrites the precached `index.html` the old worker
 * serves every page from (`pwa/sw.js`), so a plain reload already runs the new
 * version while its worker still waits: the browser lets a waiting worker take
 * over only once no tab uses the old one, and a reload keeps its tab. Such a
 * page lets the worker take over quietly and says nothing (issue #273). The
 * page tells by its entry script: its own against the precached `index.html`'s.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface UpdateState {
  /** A newer version is installed (web: a waiting service worker) or downloaded (desktop). */
  waiting: boolean;
  /** The waiting version, where the platform knows it (the desktop's updater does). */
  version?: string;
  /**
   * The desktop's last check (ADR-0090 §1, the app menu's version strip): running, or
   * finished with nothing newer. Absent before any check, and on the web.
   */
  check?: 'checking' | 'current';
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
  /**
   * Whether this page runs an older version than the newest one a worker installed
   * (`pageIsOlder` below): false when it runs that very version, undefined when it
   * can't tell (then a waiting worker counts as an update, as it always did).
   */
  pageIsOlder?(): Promise<boolean | undefined>;
}

/** How often an open page asks the host for a new `sw.js` (the browser itself only does so on navigation). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * What `Platform.updates` offers (P6-01 slice 4): one bit of state and a way to
 * apply it. The web's is `appUpdates` (a waiting service worker, then a reload);
 * the desktop's follows electron-updater in main (a downloaded update, then a
 * restart). The toast's button says which (`action`, "Reload" by default).
 */
export interface PlatformUpdates {
  readonly store: UpdateStore;
  /**
   * Applies the waiting update. False when nothing waits (the caller then does
   * nothing). Callers save the design first.
   */
  apply(): Promise<boolean>;
  /** The ready toast's button: "Reload" on the web (the default), "Restart" on the desktop. */
  readonly action?: string;
  /**
   * Help › Check for Updates… (desktop only, P6-01): asks the updater to check now; its
   * answer arrives as a notification. Absent on the web, whose worker checks itself.
   */
  check?(): void;
}

export interface Updates extends PlatformUpdates {
  /** Starts watching a registration (called once it exists). */
  watch(registration: RegistrationLike, container: ContainerLike): void;
  /**
   * Lets the waiting worker take over, then reloads. False when nothing waits (the
   * caller then does nothing). Callers save the design first.
   */
  apply(): Promise<boolean>;
}

/** An update store with nothing waiting (the desktop's follows main's status, P6-01 slice 4). */
export const createUpdateStore = (): UpdateStore =>
  createStore<UpdateState>(() => ({ waiting: false }));

export function createUpdates(env: UpdateEnv): Updates {
  const store = createUpdateStore();
  let current: { registration: RegistrationLike; container: ContainerLike } | undefined;

  const check = async () => {
    if (!current) return;
    const { registration, container } = current;
    // A first visit has no controller: nothing there can be "an update".
    if (!container.controller) {
      store.setState({ waiting: false });
      return;
    }
    const older = await env.pageIsOlder?.();
    const worker = registration.waiting;
    if (worker && older === false) {
      // This page already is the waiting version (a reload brought it): nothing to reload.
      worker.postMessage({ type: 'SKIP_WAITING' });
      store.setState({ waiting: false });
      return;
    }
    // Another tab let a newer version take over: this one still runs the old bundle.
    const newerActive = !worker && !registration.installing && older === true;
    store.setState({ waiting: !!worker || newerActive });
  };

  return {
    store,
    watch(registration, container) {
      current = { registration, container };
      void check();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') void check();
        });
      });
      container.addEventListener('controllerchange', () => void check());
      env.schedule(() => {
        registration.update().catch(() => {});
        void check();
      });
    },
    async apply() {
      if (!current) return false;
      const { registration, container } = current;
      const worker = registration.waiting;
      if (!worker) {
        // Either someone already applied it here, or another tab did and only a reload is left.
        await check();
        if (!store.getState().waiting) return false;
        env.reload();
        return true;
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

/**
 * The first module script's address in a page's HTML, resolved against `base`: Vite's
 * entry, whose name hashes the build (any change to the app changes it).
 */
export function entryScript(html: string, base: string): string | undefined {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype=["']?module\b/i.test(tag)) continue;
    const src = /\bsrc=["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (src) return new URL(src, base).href;
  }
  return undefined;
}

/** Where `pwa/sw.js` keeps the page (its `CACHE` and `INDEX`; a test holds them equal). */
export const PRECACHE = 'extrudo-precache';
export const PRECACHE_INDEX = './index.html';

/**
 * Whether this page runs an older build than the precached `index.html`, which the
 * newest installed worker wrote (waiting or active). Undefined when either is missing.
 */
async function pageIsOlder(): Promise<boolean | undefined> {
  try {
    const own = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!own) return undefined;
    const index = new URL(PRECACHE_INDEX, location.href).href;
    const cached = await (await caches.open(PRECACHE)).match(index, { ignoreVary: true });
    const entry = cached && entryScript(await cached.text(), index);
    return entry ? entry !== own : undefined;
  } catch {
    return undefined;
  }
}

/** The page's updates: the browser's reload and an hourly check (and one when the tab comes back). */
export const appUpdates: Updates = createUpdates({
  pageIsOlder,
  reload: () => globalThis.location.reload(),
  schedule(check) {
    setInterval(check, UPDATE_CHECK_MS);
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});
