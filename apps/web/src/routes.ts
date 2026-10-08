/**
 * Hash routes (Electron-safe, architecture §8): `#/` home, `#/p/<id>` a
 * project, `#/example/<id>` one of the example designs (P6-06 S3: it copies
 * the design into a new project and replaces the route with the project's,
 * so Back doesn't come back), `#/debug/kernel`, `#/debug/solver`,
 * `#/debug/dialog` and `#/debug/crash` (throws on render, for the root error
 * boundary's e2e test, ADR-0076) the debug pages.
 */
import { useSyncExternalStore } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'project'; id: string }
  | { page: 'example'; id: string }
  | { page: 'debug-kernel' }
  | { page: 'debug-solver' }
  | { page: 'debug-dialog' }
  | { page: 'debug-crash' }
  | { page: 'not-found'; hash: string };

export const HOME_HREF = '#/';
export const projectHref = (id: string) => `#/p/${encodeURIComponent(id)}`;
export const exampleHref = (id: string) => `#/example/${encodeURIComponent(id)}`;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/') return { page: 'home' };
  if (path === '/debug/kernel') return { page: 'debug-kernel' };
  if (path === '/debug/solver') return { page: 'debug-solver' };
  if (path === '/debug/dialog') return { page: 'debug-dialog' };
  if (path === '/debug/crash') return { page: 'debug-crash' };
  const project = /^\/p\/([^/]+)$/.exec(path);
  if (project?.[1]) return { page: 'project', id: decodeURIComponent(project[1]) };
  const example = /^\/example\/([^/]+)$/.exec(path);
  if (example?.[1]) return { page: 'example', id: decodeURIComponent(example[1]) };
  return { page: 'not-found', hash };
}

export function navigate(href: string): void {
  window.location.hash = href;
}

/**
 * Navigates by replacing the current history entry, so Back doesn't return to
 * the page that handed over (the example opener, a redirect).
 */
export function replaceRoute(href: string): void {
  window.location.replace(href);
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, () => window.location.hash));
}
