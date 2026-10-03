// Retires the app's service worker (ADR-0057). Until 2026-10-03 the app lived at
// extrudo.org with a service worker that answers every navigation from its
// precache, so a returning visitor would keep getting the old app instead of this
// landing page. The browser checks /sw.js for an update on each visit and finds this
// file: it takes over at once (no waiting), deletes the precache, unregisters itself
// and reloads the open pages, which then load the landing page from the network (a page
// that was still loading shows it on its next visit).
// It has no fetch handler, so it never answers a request itself.

self.addEventListener('install', () => self.skipWaiting());

// Chrome can still hold this worker back while a tab of the old app is open. That app
// then shows "A new version of Extrudo is ready", whose Reload button sends this
// message (ADR-0054); otherwise it takes over on the next visit, once that tab is gone.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.clients.claim();
      await self.registration.unregister();
      // A page still loading may not be controlled yet and refuses navigate(); its next
      // load goes to the network anyway, since this worker is gone by then.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(windows.map((client) => client.navigate(client.url).catch(() => {})));
    })(),
  );
});
