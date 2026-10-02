# ADR-0054: Public release: hosting, headers, deploy, community files, update toast

- **Status:** Accepted, 2026-10-02
- **Task:** P3-15. Code: `apps/web/public/_headers`, `apps/web/pwa/headers.ts`
  and `site.ts`, `apps/web/pwa/sw.js`, `apps/web/src/platform/updates.ts`,
  `updateNotice.ts`, `serviceWorker.ts`, `shell/useUpdateNotice.ts`,
  `project/autosave.ts` (`saveEverything`), `.github/workflows/deploy.yml`,
  `scripts/check-licenses.mjs`, `e2e/static-host.ts`, `e2e/hosting.spec.ts`,
  `e2e/pwa.spec.ts`. Docs: `docs/deploy.md`, `docs/release-checklist.md`,
  `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `NOTICE`, `.github/` templates.
- **Builds on:** ADR-0037 (service worker, precache, the host's header
  requirements and the open "update available" toast), ADR-0041 (a toast
  action says whether it still applies), ADR-0009 (autosave, rescue copies),
  ADR-0034 (the slicer check that stays the owner's).

## Context

The owner decided on 2026-10-02: GPL-3.0-or-later with MIT for `packages/io` and
the file-format spec (decided in P0-01; checked here), Cloudflare Pages deployed
from GitHub Actions, the Contributor Covenant 2.1, and GitHub private
vulnerability reporting with no email address in the repository. The domain
`extrudo.app` was planned and then found taken; the owner registered
**`extrudo.org`** in Cloudflare the same day (still to be attached to the Pages
project, which until then answers at `extrudo.pages.dev`).

## Decisions

1. **Cloudflare Pages, deployed by our own workflow.** A static site with a
   `_headers` file is all we need: custom response headers (COOP/COEP now,
   multi-threaded WASM later), a free tier, assets up to 25 MiB (the OCCT WASM
   is 15.8 MB), brotli at the edge, easy rollback. The Pages project is made by
   Direct Upload and **not** connected to the repository: Cloudflare's own
   git build would skip our CI gate and the WASM download.
   Rejected: **GitHub Pages** (no custom response headers, so no COOP/COEP and no
   `Cache-Control` for `sw.js`; a service-worker header workaround is not
   possible); **a Hetzner server** (we would maintain a machine, TLS and a
   web server for a static site); **Netlify** (works, same `_headers` idea, but no
   reason to prefer it over Cloudflare, whose free plan has no build-minute or
   bandwidth caps that matter to us and where the owner wanted to put the
   domain); Vercel (no benefit, a commercial-use clause on the free tier).

2. **The public address is one setting.** `apps/web/pwa/site.ts` holds the
   default `https://extrudo.org` and reads `SITE_URL` at build time;
   a Vite plugin fills `__SITE_URL__` in the canonical link and the Open Graph
   and Twitter tags of `index.html` (a test checks that the page names no
   other address). The deploy workflow passes the repository **variable**
   `SITE_URL` when it is set (a fork, a staging site); the default is the project
   domain, so the owner only attaches it in Cloudflare. The manifest uses
   relative URLs and needs none. `extrudo.app` appears nowhere in the code.
   The link-preview picture `og-image.png` (1200 × 630) is rendered from
   `docs/brand/og-image.html`; it is left out of the precache.

3. **Headers** (`public/_headers`, in the build as `dist/_headers`):
   - `Cross-Origin-Opener-Policy: same-origin` and
     `Cross-Origin-Embedder-Policy: require-corp` on everything. **`require-corp`
     works because the app loads nothing from other origins**: the fonts are
     bundled through `@fontsource` (no Google Fonts), the WASM and workers are
     same-origin, blobs and data URLs are exempt. Verified in a real browser
     (`crossOriginIsolated` is true; kernel, solver, recompute, 3MF export all
     run). `credentialless` is the fallback if a third-party resource ever sends
     no CORP header; self-hosting the fonts was not needed.
   - `Cache-Control: no-cache` for `/`, `/index.html`, `/sw.js` and
     `/manifest.webmanifest` (ADR-0037's requirement), `public, max-age=31536000,
     immutable` for `/assets/*`. Cloudflare **joins** the values of every
     matching rule, so the cache rules never overlap (a test asserts it).
   - `X-Content-Type-Options: nosniff`, `Referrer-Policy:
     strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off
     camera, microphone, geolocation, payment and USB.
   - **`Content-Security-Policy`**: `default-src 'self'`, `script-src 'self'
     'wasm-unsafe-eval' 'unsafe-eval'`, `style-src 'self' 'unsafe-inline'`
     (React and Radix set style attributes), images and media from self, data and
     blob, workers from self and blob, `object-src 'none'`, `frame-ancestors
     'none'`, no other origin anywhere. **`'unsafe-eval'` had to stay**: building a
     CSP-checking e2e run showed that the kernel does not start without it (the
     OCCT build's embind creates functions with `new Function`, in the worker) and
     the planegcs glue does the same in the page. We kept the policy (no inline
     script, no foreign script, no framing, no plugins, a fixed base URI) rather
     than leaving it out. The proper fix is to rebuild both WASM with
     `-sDYNAMIC_EXECUTION=0`; it changes both input hashes (OCCT takes about 15
     minutes in CI), needs a check that embind still works, and is on the P4-12
     backlog. Rejected: a stricter policy for the page with a separate looser one
     for the kernel worker (Cloudflare joins overlapping rules and the stricter
     policy would win; mid-path rules and `!` detaching were not worth it for a
     policy that would still need `'unsafe-eval'` for the solver).
   - Zod probes `new Function` at start-up. When the policy forbids eval that
     probe is a reported violation (a console error) though it is caught; with
     eval allowed it is silent. Once `'unsafe-eval'` goes, set
     `z.config({ jitless: true })` before any schema is defined (measured: a
     document parses in 0.6 ms with or without the fast path).
   - `vite preview` serves the global block (`preview.headers` reads `/*` from
     the file), and the e2e suite runs on it: **every spec runs under COOP/COEP
     and the CSP**. `e2e/hosting.spec.ts` serves `dist` through
     `e2e/static-host.ts`, which applies the whole file with path rules like
     Cloudflare, and checks isolation, no CSP violations (it listens for
     `securitypolicyviolation`) and no console errors while the kernel
     computes, a 3MF is exported and a sketch solves.

4. **The deploy workflow** (`deploy.yml`): runs after the `CI` workflow
   **succeeded for a push to main** (`workflow_run`), on the exact commit CI
   tested, or by hand on main. Its first step checks that the repository secrets
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist; without them it
   prints a notice and skips the rest (a green run), so a fork or an unconfigured
   repository never fails. It builds with `pnpm build` (the WASM comes from the
   releases CI publishes) and deploys `apps/web/dist` with a pinned `npx wrangler` to the
   project `extrudo` (`wrangler-action` was dropped after the first deploy: in a
   pnpm workspace it runs `pnpm add wrangler` in the root, which pnpm refuses). It never creates secrets, projects or tokens; the owner's
   one-time steps are in `docs/deploy.md`. Rejected: deploying from the CI
   workflow itself (a failing deploy would fail CI, and a manual redeploy would
   need all of CI); Cloudflare's git integration (no gate).

5. **The update toast.** The service worker no longer calls `skipWaiting()` at
   install: a **first install** activates by itself, an **update installs and
   waits** and activates when the page sends `{type: 'SKIP_WAITING'}`
   (ADR-0037's "activates at once" is replaced, its other rules stay: hashed
   files kept one more generation, fixed files re-fetched). `platform/updates.ts`
   (vanilla store `{waiting}`, fakes in tests) watches the registration
   (`updatefound` → `installed`, only when a controller exists, so a first visit
   is no "update"), asks the host for a new `sw.js` every hour and when the tab
   becomes visible (a design stays open for hours; the browser alone checks on
   navigation), and `apply()` posts `SKIP_WAITING`, waits for `controllerchange`
   (4 s at most) and reloads. The pages that have toasts (home, a project) call
   `useUpdateNotice`: **"A new version of Extrudo is ready."** with **Reload**,
   30 s, an info toast in the notification history whose action has
   `available()` = "an update still waits" (ADR-0041). **Reload never
   discards work**: it first calls `saveEverything()` (autosave's registry of live
   autosavers: flush each, say whether all are `saved`); if a save failed it
   shows an error ("Your changes couldn't be saved, so Extrudo didn't reload…")
   and stays. The rescue copy on `pagehide` (ADR-0009) is the second net.
   Rejected: reloading automatically; a modal; `skipWaiting` on every update
   with a reload prompt afterwards (the new worker would already serve new files
   to the old page, so lazy chunks of the running version could miss).
   Tested: unit tests for the watcher, the toast and `saveEverything`, and
   `e2e/pwa.spec.ts` with a host that serves a changed `sw.js`, checking that
   nothing swaps before Reload, that the new version is active after it and that a
   rename made just before survives.

6. **Community files.** `CODE_OF_CONDUCT.md` is the Contributor Covenant 2.1
   verbatim except the enforcement contact: the project address
   `conduct@extrudo.org` (Cloudflare Email Routing forwards it to the owner;
   added 2026-10-02 once the domain existed; at first it had no email and
   pointed to an issue asking for a private channel) or GitHub's "Report
   content". No personal address is in the repository. `SECURITY.md` points at GitHub's "Report a vulnerability" (the owner
   enables private vulnerability reporting), with modest response goals.
   `CONTRIBUTING.md` documents setup, the roadmap/ADR/CHANGELOG workflow, the
   hard rules in contributor language, style, tests, screenshot baselines in the
   Playwright image, commits, and the licenses; its note on AI-assisted
   contributions only says the same rules apply (no new policy). Issue **forms**
   (bug report with steps, browser, OS, console errors and the `.extrudo` file;
   feature request pointing at requirement and roadmap IDs), blank issues off,
   a security link, and a pull request template.

7. **Licenses.** Verified: every `package.json` says GPL-3.0-or-later except
   `packages/io` (MIT, with its own LICENSE); `docs/file-format.md` now states
   that it is MIT and `docs/file-format.LICENSE` holds the text; the C++ facade and
   our planegcs patch are LGPL-2.1-or-later (file headers, `facade/LICENSE`).
   `NOTICE` lists the WASM components with where to get their sources, the
   fonts (OFL-1.1) and every production dependency by license, and names
   **taucad/opencascade.js#40** (still open and unanswered on 2026-10-02). No
   production dependency is incompatible with GPL-3.0 distribution (MIT, ISC,
   BSD-3, 0BSD, Apache-2.0, OFL-1.1, LGPL-2.0-or-later; Apache-2.0 is compatible
   with GPL-3.0). `scripts/check-licenses.mjs` (part of `pnpm lint`) keeps it so:
   an SPDX allow-list over `pnpm licenses list --prod`, and OFL/LGPL packages
   must be named in `NOTICE`.

8. **The audit** (2026-10-02): the whole tree, the full history (all refs,
   every added line of text files; PNG and WASM skipped) and the fixtures
   (unzipped) were searched for home paths, emails, private IP ranges,
   LAN and tailnet host names, tokens and keys, and personal names, and
   scanned with gitleaks (the tree and 145 commits of main): **nothing to
   remove.** The only hits are the GitHub owner name in the repository URL
   (`zoltanf/extrudo`: the public repository), and `/home/` as part of
   `apps/web/src/home/`. `spikes/` and `fixtures/` hold no paths or
   addresses. **One note for the owner, not fixable in the tree:** all
   commits (as author and committer) carry the owner's personal email address;
   history was not rewritten. See `docs/release-checklist.md` for the options.
   CLAUDE.md and the docs name machines only by role ("the Arch workstation",
   "the Ubuntu machine") and contain no user name or path.

## Consequences

- The site can be deployed as soon as the owner adds two secrets; until then
  nothing runs.
- Every e2e spec now runs under COOP/COEP and the CSP, so a new feature that
  loads a cross-origin resource or evaluates a string fails CI at once.
- Open items: drop `'unsafe-eval'` (both WASM rebuilds, P4-12); a measurement on
  the real host with real latency (ADR-0037); attaching `extrudo.org` (owner); consider
  `Cross-Origin-Resource-Policy` and `Strict-Transport-Security` (Cloudflare adds
  HTTPS redirects; HSTS is a setting there); a `security.txt` once there is a
  project address; Dependabot or Renovate for the dependency list the license
  check watches.
