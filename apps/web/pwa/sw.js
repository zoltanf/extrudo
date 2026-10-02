// Extrudo's service worker (ADR-0037). Built into dist/sw.js by
// pwa/precache-plugin.ts, which fills in VERSION and the file lists.
//
// It precaches the whole app at install (the two WASM files included), so a
// repeat visit, offline or not, never waits for the network, and answers every
// request from that cache. Hashed files (assets/…) are fetched once and kept
// across versions; the few files with fixed names are fetched again at every
// install. An update installs, activates at once (no waiting for every tab to
// close) and keeps the previous version's files too, so a tab that is still
// running the old bundle finds its lazy chunks. The new version's index.html
// shows on the next navigation.

/* global self, caches */
const VERSION = '__VERSION__';
const HASHED = /*__HASHED__*/ [];
const FIXED = /*__FIXED__*/ [];

const CACHE = 'extrudo-precache';
const INDEX = './index.html';
// The URLs the previous version precached: this version keeps them one more round.
const PREVIOUS = './.previous-precache';

const url = (path) => new URL(path, self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const have = new Set((await cache.keys()).map((request) => request.url));
      // 'reload' skips the HTTP cache: precached files must be this build's.
      const add = (path) => cache.add(new Request(url(path), { cache: 'reload' }));
      await Promise.all([
        ...HASHED.filter((path) => !have.has(url(path))).map(add),
        ...FIXED.map(add),
      ]);
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const previous = await cache
        .match(url(PREVIOUS))
        .then((response) => (response ? response.json() : []))
        .catch(() => []);
      const current = [...HASHED, ...FIXED].map(url);
      const keep = new Set([...current, ...previous, url(PREVIOUS)]);
      for (const request of await cache.keys()) {
        if (!keep.has(request.url)) await cache.delete(request);
      }
      await cache.put(
        url(PREVIOUS),
        new Response(JSON.stringify(current), { headers: { 'x-extrudo-version': VERSION } }),
      );
      // Caches of other names (an earlier scheme) are never ours to keep.
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const target = new URL(request.url);
  if (target.origin !== self.location.origin) return;
  // The tools' demo clips (P3-12) aren't precached and are range-requested by
  // <video>: the browser fetches them itself.
  if (/\/demos\/[^/]+$/.test(target.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Every navigation is the one page: routes are hash routes.
      // ignoreVary: a host's `Vary: Origin` would otherwise miss module scripts,
      // whose requests carry an Origin header the precache's requests lack.
      const hit = await cache.match(request.mode === 'navigate' ? url(INDEX) : request.url, {
        ignoreVary: true,
      });
      return hit ?? fetch(request);
    })(),
  );
});
