import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/600.css';
import './site.css';

// Until 2026-10-03 the app itself lived at extrudo.org (ADR-0057). Its routes are
// hash routes, so an old link like extrudo.org/#/p/<id> goes on to the app. Its home
// route, a bare `#/`, stays here: that is the landing page's address now.
if (/^#\/./.test(location.hash)) {
  location.replace(`${__APP_URL__}/${location.hash}`);
} else if (location.hash === '#/') {
  history.replaceState(null, '', location.pathname + location.search);
}

// That app also left a service worker and its precache here. public/sw.js retires
// the worker for browsers that still load the old app; this covers a browser that
// reaches the landing page with the registration still around.
navigator.serviceWorker
  ?.getRegistrations()
  .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
  .catch(() => {});
globalThis.caches
  ?.keys()
  .then((names) => Promise.all(names.map((name) => caches.delete(name))))
  .catch(() => {});

// The intro video is optional: without it (or if it fails) the poster picture stays.
for (const video of document.querySelectorAll<HTMLVideoElement>('video[data-intro]')) {
  const fallback = () =>
    video.replaceWith(
      Object.assign(new Image(), {
        src: video.poster,
        alt: video.getAttribute('aria-label') ?? '',
        className: video.className,
      }),
    );
  // The source may have failed before this module ran.
  if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) fallback();
  else video.querySelector('source')?.addEventListener('error', fallback);
}
