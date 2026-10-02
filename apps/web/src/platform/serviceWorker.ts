/**
 * Offline support (a platform interface, ADR-0037): registers the service
 * worker that precaches the app, WASM included. The web build only, in a
 * production build only: in `pnpm dev` a worker would fight Vite's HMR, and
 * the Electron build loads from file:// where there is none (and doesn't need
 * one). Registration waits for the page to finish loading so it never
 * competes with the first visit's own downloads. Once registered, the
 * registration is watched for updates (`updates.ts`, ADR-0054).
 */
import { appUpdates, type ContainerLike, type RegistrationLike, type Updates } from './updates';

export interface ServiceWorkerHost {
  readonly production: boolean;
  readonly protocol: string;
  /** Present where the browser has service workers. */
  readonly container:
    | (ContainerLike & { register(url: string): Promise<RegistrationLike> })
    | undefined;
  onLoad(run: () => void): void;
  /** Where "an update is waiting" goes; the page's own by default. */
  readonly updates?: Pick<Updates, 'watch'>;
}

/** Whether a service worker can and should run here. */
export function offlineSupported(host: ServiceWorkerHost): boolean {
  return (
    host.production && !!host.container && (host.protocol === 'https:' || host.protocol === 'http:')
  );
}

/** Registers `sw.js` (next to the page). Returns whether it tried; failures are only logged. */
export function registerServiceWorker(host: ServiceWorkerHost = browserHost()): boolean {
  const container = host.container;
  if (!offlineSupported(host) || !container) return false;
  host.onLoad(() => {
    container
      .register('./sw.js')
      .then((registration) => (host.updates ?? appUpdates).watch(registration, container))
      .catch((error: unknown) => {
        console.warn('Offline support is off: the service worker did not register.', error);
      });
  });
  return true;
}

function browserHost(): ServiceWorkerHost {
  return {
    production: import.meta.env.PROD,
    protocol: globalThis.location?.protocol ?? '',
    container: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    onLoad: (run) => {
      if (document.readyState === 'complete') run();
      else window.addEventListener('load', run, { once: true });
    },
  };
}
