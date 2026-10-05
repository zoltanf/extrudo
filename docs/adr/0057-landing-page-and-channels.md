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
can't load, the page shows the picture instead. Self-hosted: no video platform and
no tracking by a video platform, and the video stays on this origin.

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

## Amendment (2026-10-04): Web Analytics on the landing page only

### Decision

The landing page at `extrudo.org` is counted with **Cloudflare Web Analytics**,
turned on through the Pages project's own setting (`extrudo-site` › Metrics ›
Web Analytics › Enable), and **off** for the `extrudo` project, so neither
`app.extrudo.org` nor `edge.extrudo.org` (a branch of that project) gets it.

Pages injects the tag itself, before `</body>`:

```html
<!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "…"}'></script><!-- Cloudflare Pages Analytics -->
```

so the repository holds neither the tag nor the token, and every local build
stays free of it. Two directives of the site's policy make room for it
(`apps/site/public/_headers`):
`script-src 'self' https://static.cloudflareinsights.com` and
`connect-src 'self' https://cloudflareinsights.com` (the beacon posts its data to
`https://cloudflareinsights.com/cdn-cgi/rum`). Everything else in that policy is
unchanged, and **the app's policy is untouched**: it names no host but this
origin, which is what keeps a beacon from ever running on `app.` or `edge.`
(`apps/web/pwa/headers.test.ts` checks both files).

The footer says what is counted: this page counts visits, the app has no
analytics, designs stay in the browser, and Cloudflare — the host of both — sees
every visitor's IP address like any web host. **No cookie banner**: the beacon
sets no cookies and uses no storage. The note tells visitors what is processed
and by whom, which the GDPR's transparency rules ask for anyway.

**Contact address.** The footer names **`hello@extrudo.org`** as a plain
`mailto:` link, with the address as visible text too, so it can be copied without
a mail program. Cloudflare Email Routing forwards it to the owner, like
`conduct@`, so no inbox address is in the repository. It is a build-time setting
like the three URLs (`CONTACT_EMAIL` in `apps/site/addresses.ts`, `email()`
beside `baseUrl()` validates it).

### Why Cloudflare's

- Cloudflare already serves the site and sees every request, so the beacon adds
  no new third party to the page. It is free and cookieless.
- It gives what the free plan's server-side traffic analytics don't: **referrers,
  device type, browser and OS**, and counts of real browsers with bots
  filterable. The server-side numbers (requests, bandwidth, unique visitors,
  countries) are for the zone, count crawlers, and are kept 30 days.
- The project's own setting is a checkbox, not a snippet to keep current.

### Rejected

- **Server-side analytics only.** No referrers and no devices on the free plan,
  and crawlers mixed into the counts.
- **Plausible, Umami or GoatCounter.** The same data from another company in the
  page's requests, and a script of ours to maintain.
- **Pasting the snippet into `index.html`.** The token would live in the
  repository, and every local build, preview and e2e run would load a
  cross-origin script (and fail under the very policy that has to allow it).
- **A contact form** instead of the address. It would need a Pages Function to
  send mail, Turnstile against spam (another script host, and a frame host, in
  the content policy) and personal data handled by our own code — for a problem a
  forwarded address in an inbox with a spam filter already handles. Revisit if
  the spam gets bad.

### Consequences

- Ad blockers hide some visitors, so the server-side numbers are the upper bound
  and the two don't have to agree.
- The Pages setting injects the tag at a deployment: turning it on or off takes
  effect when that project is next deployed (`docs/deploy.md`).
- `e2e/site.spec.ts` checks that the injected tag runs under the site's policy:
  it serves the built `index.html` with the tag added and stubs both Cloudflare
  hosts, so a future tightening of the policy can't silently block the beacon.
- The owner flipped both switches on 2026-10-04 and disabled the zone's older
  automatic setup for extrudo.org (`docs/deploy.md` step 5).

## Amendment (2026-10-05): a scroll walkthrough replaces the intro video

### Decision

The intro video under the hero (`apps/site/public/media/intro.webm`, with
`src/images/bracket.webp` as its poster) gives way to a **walkthrough**: nine
pictures of the real app building a small **PCB enclosure from sketches and
extrusions**, each with a short caption, which change as the visitor scrolls.
The video's poster was what most visitors saw (it doesn't play by itself), and
a still that changes with the scroll shows the workflow at the reader's pace.

The steps (captions in `apps/site/index.html`, pictures recorded by the app):

1. An empty design.
2. A sketch: a rectangle centred on the origin with two named dimensions,
   `width` and `depth` (named dimensions are parameters).
3. Extrude it 30 mm into a block.
4. Shell it 2 mm, the top face removed: the tray.
5. A sketch on the front face: a slot for a USB connector.
6. Extrude the slot as a cut through the wall.
7. Four screw posts: circles on the floor placed from `width` and `depth`
   (expressions), extruded up and joined to the tray.
8. Fillet the outer vertical edges.
9. Change `width` to 100 mm: everything follows.

**The pictures are recorded from the real app**, by a `walkthrough` test in
`e2e/record-assets.spec.ts` (`RECORD_ASSETS=1`, `pnpm demos -g walkthrough`)
that builds the design through the UI as a user would and takes a screenshot
at each step, so they show the current UI and are re-recorded with one
command. A feature step is pictured **with its dialog open and the preview
drawn**, which shows how the app is used, not only the result. The screenshots
are 1440 × 900 and are encoded to **WebP in Chromium itself** (a canvas's
`toDataURL('image/webp')` in a blank page), at 1440 and 960 pixels wide for
`srcset`: no new dependency. They live in `apps/site/src/images/walkthrough/`,
so Vite hashes them like the other pictures.

**The page is progressive.** The markup is an ordered list of steps, each a
`figure` with its picture and caption, which is the whole experience without
JavaScript. `main.ts` enhances it: a **stage** pinned beside the captions
(`position: sticky`; above them on a phone) holds a copy of every picture
(`aria-hidden`, empty `alt`, since the list keeps the real ones, visually
hidden), and an `IntersectionObserver` on the captions' middle band makes the
step there current: `data-active-step` on the section, `aria-current="step"`
on its item, and the stage **crossfades** to its picture, with "Step 3 of 9"
and a progress bar. Under `prefers-reduced-motion` the pictures swap without
the fade. No library and no inline script, so the site's content policy is
unchanged.

### Rejected

- **Autoplaying the video.** It runs at its own pace, not the reader's, plays
  in a loop whether anyone watches or not, and is 4-5 times the bytes of the
  pictures.
- **A carousel with arrows.** Another control to find and press, and the
  pictures would be hidden behind clicks instead of the scroll the reader is
  already doing.
- **CSS scroll-driven animations (`animation-timeline: view()`).** Not in every
  browser the site supports, and a step's state (`aria-current`, the counter)
  needs script anyway.
- **The PCB enclosure template's own route** (Box and Cylinder primitives, a
  hole preset, a pattern). It is shorter, but the owner wanted the sketch and
  extrude workflow, which is how most parts start.

### Consequences

- `intro.webm`, its poster and its recorder (`intro: the landing page video`)
  go; the template pictures and tool demos are untouched.
- The pictures are about 1-1.5 MB together and load only as the section comes
  near (`loading="lazy"`, the first one eager).
- `e2e/site.spec.ts` checks the list without JavaScript, the stage following
  the scroll (desktop and phone width), reduced motion, and that every picture
  comes from the build; the contrast and axe tests cover the captions.
