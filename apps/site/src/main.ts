import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/600.css';
import './site.css';
import { enhanceToy } from './toy';
import { enhance } from './walkthrough';

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

// The scroll walkthrough: without JavaScript the ordered list stays the whole
// experience; this adds the sticky stage and follows the scroll.
for (const section of document.querySelectorAll<HTMLElement>('[data-walkthrough]')) {
  enhance(section);
}

// The hero's parametric toy: its markup is in the page, this makes it move.
for (const toy of document.querySelectorAll<HTMLElement>('[data-toy]')) {
  enhanceToy(toy);
}

// Scroll reveals: the cards and the templates fade up as they arrive. Without this
// script, or under reduced motion, they are simply there (site.css only hides them
// for `html.js` under `prefers-reduced-motion: no-preference`).
document.documentElement.classList.add('js');
const seen = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      seen.unobserve(entry.target);
    }
  },
  { rootMargin: '0px 0px -8% 0px' },
);
for (const element of document.querySelectorAll('.cards li, .templates')) seen.observe(element);
