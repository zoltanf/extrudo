// Extrudo's service worker (ADR-0037). Built into dist/sw.js by
// pwa/precache-plugin.ts, which fills in VERSION and the file lists.
//
// It precaches the whole app at install (the two WASM files included), so a
// repeat visit, offline or not, never waits for the network, and answers every
// request from that cache. Hashed files (assets/…) are fetched once and kept
// across versions; the few files with fixed names are fetched again at every
// install. An update installs and then waits (ADR-0054: the page shows "A new
// version is ready" and sends SKIP_WAITING when the person agrees, so it never
// swaps under an open design); on activation it keeps the previous version's
// files too, so a tab that is still running the old bundle finds its lazy
// chunks. The new version's index.html shows on the next navigation.
//
// OpenSCAD's WASM (ADR-0071 §4) is not precached: it is 11 MB few designs need.
// The first fetch of it goes to the network and is kept in a cache of its own,
// so every later `.scad` import works offline; an update keeps it while the
// build's hashed name is the same, and drops any other.

/* global self, caches */
const VERSION = '__VERSION__';
const HASHED = /*__HASHED__*/ [];
const FIXED = /*__FIXED__*/ [];
// Files cached on first use instead of at install: this build's OpenSCAD WASM.
const RUNTIME = /*__RUNTIME__*/ [];

const CACHE = 'extrudo-precache';
const RUNTIME_CACHE = 'extrudo-openscad';
const IS_RUNTIME = /\/assets\/openscad-[^/]+\.wasm$/;
const INDEX = './index.html';
// The URLs the previous version precached: this version keeps them one more round.
const PREVIOUS = './.previous-precache';

const url = (path) => new URL(path, self.location.href).href;

// A host may answer a path through a redirect: Cloudflare Pages sends
// `/index.html` to `/` with a 308. The response fetch() returns then says
// `redirected`, and a browser refuses such a response for a navigation
// (ERR_FAILED on every visit after the first). Store and serve a plain copy.
const plain = async (response) =>
  response.redirected
    ? new Response(await response.blob(), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    : response;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const have = new Set((await cache.keys()).map((request) => request.url));
      // 'reload' skips the HTTP cache: precached files must be this build's.
      const add = async (path) => {
        const response = await fetch(new Request(url(path), { cache: 'reload' }));
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        await cache.put(url(path), await plain(response));
      };
      await Promise.all([
        ...HASHED.filter((path) => !have.has(url(path))).map(add),
        ...FIXED.map(add),
      ]);
      // No skipWaiting() here: a first install activates by itself (nothing to wait
      // for), an update waits for the page's SKIP_WAITING message.
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
      // The runtime cache keeps only what this build would fetch.
      const runtime = await caches.open(RUNTIME_CACHE);
      const wanted = new Set(RUNTIME.map(url));
      for (const request of await runtime.keys()) {
        if (!wanted.has(request.url)) await runtime.delete(request);
      }
      // Caches of other names (an earlier scheme) are never ours to keep.
      for (const name of await caches.keys()) {
        if (name !== CACHE && name !== RUNTIME_CACHE) await caches.delete(name);
      }
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
  // OpenSCAD's WASM: from its own cache, else fetched once and kept (ADR-0071 §4).
  if (IS_RUNTIME.test(target.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const hit = await cache.match(request.url, { ignoreVary: true });
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok && !response.redirected) await cache.put(request.url, response.clone());
        return response;
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Every navigation is the one page: routes are hash routes.
      // ignoreVary: a host's `Vary: Origin` would otherwise miss module scripts,
      // whose requests carry an Origin header the precache's requests lack.
      const hit = await cache.match(request.mode === 'navigate' ? url(INDEX) : request.url, {
        ignoreVary: true,
      });
      return hit ? plain(hit) : fetch(request);
    })(),
  );
});
