# ADR-0057: Landing page at extrudo.org, the app at app. and edge.

- **Status:** accepted
- **Date:** 2026-10-03
- **Context task:** none on the roadmap; the owner asked for it the day after the
  first deploy (ADR-0054)

## Context

Since 2026-10-02 the app itself answered at `extrudo.org`. The owner wants:

- a **landing page** at `extrudo.org`: what Extrudo is, an intro video, and a big
  button into the app;
- the **stable app** at `app.extrudo.org`;
- the **latest build** at `edge.extrudo.org`, for people who want new features
  before a release.

Things that constrain it: the app is an offline PWA whose service worker answers
every navigation from its precache (ADR-0037, ADR-0054), so visitors from the
first day still have it at `extrudo.org`; designs live in the browser's storage
per origin (ADR-0009); the hosting is Cloudflare Pages with GitHub Actions
deploying behind the CI gate (ADR-0054); the project must never hard-code a
domain (ADR-0054).

## Decision

### 1. The landing page lives in this repository, as `apps/site`

A static page built with Vite: `index.html` (hero with "Open Extrudo", the intro
video, six feature cards, a templates section, a footer), `src/site.css` (the
brand tokens of `docs/05-brand.md`, dark by default and light from the system
setting), a 1 kB script and the bundled Instrument Sans. No framework, no
internal packages (`scripts/check-boundaries.mjs`: `@extrudo/site: []`), no
third-party requests. Its addresses are build-time values (`addresses.ts`:
`SITE_URL`, `APP_URL`, `EDGE_URL`, defaults `extrudo.org`, `app.extrudo.org`,
`edge.extrudo.org`) filled into `__APP_URL__` and friends by a Vite plugin.
`pnpm build` builds it with the app; `pnpm --filter @extrudo/site dev` (or the
`site` launch configuration) previews it.

Its `_headers` are stricter than the app's: no WASM, so no `'unsafe-eval'` or
`'wasm-unsafe-eval'`, `style-src 'self'` without `'unsafe-inline'`, no data:
URLs for fonts (`assetsInlineLimit: 0`), and no cross-origin isolation (it has
nothing to isolate).

### 2. The intro video is recorded from the real app

`e2e/record-assets.spec.ts` gained "intro: the landing page video", run by `pnpm
demos -g intro` like the tool demos (ADR-0052): the whole window at 1440 × 900,
encoded at 1280 × 800 (VP8, about 1.2 MB for 46 s) into
`apps/site/public/media/intro.webm`. It walks a real first part: the home
screen, New design, a sketch with a rectangle and one dimension, an extrude, a
fillet, then Extrude1 edited from its chip so the part grows and keeps its
rounded edge ("change one number and the whole part follows"). Info toasts are
hidden for the recording. Its poster is the bracket screenshot; if the video
can't load, the page shows the picture instead. Self-hosted: no video platform,
no tracking, and the content policy stays `'self'`.

### 3. Two Pages projects, three addresses

| Address | Pages project | Deployed when |
|---|---|---|
| `extrudo.org` (+ `www`) | `extrudo-site`, production | every green CI run on main |
| `edge.extrudo.org` | `extrudo`, branch `edge` | every green CI run on main |
| `app.extrudo.org` | `extrudo`, production branch `main` | a release tag `v*` whose commit passed CI on main, or by hand ("Run workflow", target `stable`) |

`deploy.yml` has a `plan` job that decides from the event (and refuses a tag
whose commit has no successful CI run on main), an `app` job per channel (both
build with `SITE_URL` = the stable address, so the edge build names the stable
app as canonical), and a `site` job that creates `extrudo-site` on its first run
if it is missing. The custom domain of a branch alias is a CNAME from
`edge.extrudo.org` to `edge.extrudo.pages.dev` (Cloudflare's documented way to
give a branch its own domain); the owner's steps are in `docs/deploy.md`.

The app's default `SITE_URL` is now `https://app.extrudo.org`.

### 4. Moving the app off `extrudo.org` without stranding its visitors

- **The old service worker.** A returning visitor's browser still has the app's
  worker at `extrudo.org`, which would serve the cached app forever. The site
  ships its own `/sw.js` that retires it: the browser's update check (on each
  visit), or the old app's own hourly and tab-focus check, finds a changed
  `sw.js`; it installs, calls `skipWaiting()`, deletes every cache, claims the
  pages, unregisters itself and reloads them. It has no fetch handler. Chrome can
  hold it back behind an open tab of the old app; that app then shows its "A new
  version of Extrudo is ready" toast, whose Reload sends `SKIP_WAITING`, which
  the retiring worker handles; otherwise it takes over on the next visit after
  the tab is closed. The landing page's script also unregisters any registration
  and deletes caches when it runs. `e2e/site.spec.ts` serves the app's build,
  installs its worker, switches the host to the site's build
  (`StaticHost.serve`) and checks that the landing page appears, with no
  registration and no caches left.
- **Old links.** The app's routes are hash routes; `extrudo.org/#/p/<id>` (any
  `#/` followed by something) is forwarded to the same route at the app. A bare
  `#/` (the old home route) is dropped, so the landing page shows.
- **Designs saved at `extrudo.org`** stay in that origin's storage and do not
  appear at `app.extrudo.org`. The app was public for one day, used by its owner;
  the way across is to export `.extrudo` files at the old address before the
  switch and import them at the new one (`docs/deploy.md`). Stable and edge have
  separate storage too, which keeps an edge build's experiments away from stable
  designs; the file format reads newer files leniently (ADR-0050).

## Rejected

- **A separate repository for the site.** It would duplicate the brand tokens,
  logo, fonts and the video recorder, and a change to the app and its landing
  page couldn't land in one pull request. Worth it only for a team with its own
  rhythm or license; the site is GPL with the rest.
- **One Pages project for all three.** Pages gives custom domains to the
  production deployment; the landing page and the stable app both want to be
  "production", and their headers differ.
- **A second Pages project for edge.** Works, but needs a second project and its
  domain setup; the `edge` branch alias of the app's project is one CNAME.
- **Deploying stable on every main push and edge on pull requests.** Stable then
  changes with every merge, which is what edge is for; releases are tags.
- **A redirect from `extrudo.org` to the app for everyone who used it before**
  (by cookie or storage). The landing page's button is one click, and a returning
  visitor's old designs are not at the app's origin anyway.
- **Embedding the video from a video platform.** A third-party request, tracking,
  and a looser content policy.
- **Concatenating the tools' demo clips** as the intro: they are 480 × 300 crops
  of the view without the toolbar; the intro needs the whole window and a story.

## Consequences

- Releasing means tagging: `git tag v0.3.0 && git push origin v0.3.0` deploys the
  stable app (`docs/release-checklist.md`). Until the first tag, `app.extrudo.org`
  serves the last production deployment of the `extrudo` project.
- The owner moves the custom domains once (`docs/deploy.md`, "Three addresses").
- Every green main run deploys two things (edge and the site).
- The intro video must be recorded again when the app's look changes much
  (`pnpm demos -g intro`).
- Open: `X-Robots-Tag: noindex` for edge (the canonical link already points
  search engines at the stable app); a short notice on the landing page for
  people who saved designs at `extrudo.org` on its first day, if any turn up.
