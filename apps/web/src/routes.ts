/**
 * Hash routes (Electron-safe, architecture §8): `#/` home, `#/p/<id>` a
 * project, `#/debug/kernel` the kernel debug page.
 */
import { useSyncExternalStore } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'project'; id: string }
  | { page: 'debug-kernel' }
  | { page: 'not-found'; hash: string };

export const HOME_HREF = '#/';
export const projectHref = (id: string) => `#/p/${encodeURIComponent(id)}`;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/') return { page: 'home' };
  if (path === '/debug/kernel') return { page: 'debug-kernel' };
  const project = /^\/p\/([^/]+)$/.exec(path);
  if (project?.[1]) return { page: 'project', id: decodeURIComponent(project[1]) };
  return { page: 'not-found', hash };
}

export function navigate(href: string): void {
  window.location.hash = href;
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, () => window.location.hash));
}
