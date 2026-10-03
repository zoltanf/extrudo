# Deploying Extrudo

Extrudo is static sites on **Cloudflare Pages**, deployed from GitHub Actions.
The decisions and what was rejected are in [ADR-0054](adr/0054-public-release.md)
(hosting) and [ADR-0057](adr/0057-landing-page-and-channels.md) (landing page and
channels). Every step marked "owner" is done in the Cloudflare or GitHub web
pages; until the secrets exist the deploy workflow skips itself.

## What gets deployed where

| Address | What | Pages project | When |
|---|---|---|---|
| `https://extrudo.org` (+ `www`) | the landing page, `apps/site/dist` | `extrudo-site`, production | after every green CI run on main |
| `https://edge.extrudo.org` | the latest build of the app, `apps/web/dist` | `extrudo`, branch `edge` | after every green CI run on main |
| `https://app.extrudo.org` | the stable app, `apps/web/dist` | `extrudo`, production (`main`) | when a release tag `v*` is pushed (its commit must have passed CI on main), or by hand |

The app's build is plain static files: the app, the two WASM files, `sw.js` (the
offline service worker) and `_headers`. The landing page's is one page, its CSS
and script, the fonts, the intro video (`media/intro.webm`), its own `_headers`
(stricter: no WASM, so no `'unsafe-eval'`) and a `sw.js` that retires the app's
old service worker at `extrudo.org` (ADR-0057).

`apps/web/public/_headers` becomes `dist/_headers`, which Cloudflare Pages
applies to every response:

- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
  require-corp` on everything, so the page is cross-origin isolated (needed
  later for multi-threaded WASM). The app loads nothing from other origins (the
  fonts are bundled), so `require-corp` costs nothing. If a future feature
  embeds a third-party resource that sends no CORP header, switch to
  `credentialless`.
- `Content-Security-Policy`: own origin only, no inline script, no framing. It
  still allows `'unsafe-eval'` for scripts because both WASM builds' embind glue
  creates functions with `new Function` (ADR-0054, open item).
- `Cache-Control: no-cache` for `/`, `/index.html`, `/sw.js` and
  `/manifest.webmanifest`, so an update is found at once; a year, `immutable`,
  for the hashed files in `/assets/`.
- `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.

`pnpm preview` and the end-to-end suite serve the global block, so every test
runs under the same isolation and content policy as production, and
`e2e/hosting.spec.ts` serves the build with the whole file, the way Cloudflare
does.

The app's public address appears in the canonical link and the Open Graph tags
of `index.html`. It comes from `SITE_URL` at build time and defaults to
`https://app.extrudo.org` (`apps/web/pwa/site.ts`); the deploy workflow passes the
stable address to both channels, so the edge build names the stable app as
canonical. The landing page reads `SITE_URL`, `APP_URL` and `EDGE_URL`
(`apps/site/addresses.ts`). Set the repository variables of those names only to
use other addresses (a fork, a staging site).

## One-time setup (owner)

1. **Create a Cloudflare account** (free) if there is none.
2. **Create the Pages project** named exactly `extrudo`:
   Workers & Pages > Create > Pages > **Direct Upload**. Name it `extrudo`,
   production branch `main`. Upload nothing (or any file) for now: GitHub
   Actions deploys from here on. Its first address is
   `https://extrudo.pages.dev`; the domain comes in the next section.
   Do **not** connect the GitHub repository to Pages: that would build
   without our CI gate and without the WASM download.
3. **Create an API token**: My Profile > API Tokens > Create Token > Custom token,
   permission **Account > Cloudflare Pages > Edit**, limited to this account.
   Copy it once.
4. **Find the account ID**: Workers & Pages overview, right-hand side.
5. **Add two repository secrets** (GitHub: Settings > Secrets and variables >
   Actions > New repository secret):
   - `CLOUDFLARE_API_TOKEN`: the token from step 3
   - `CLOUDFLARE_ACCOUNT_ID`: the ID from step 4
6. **Deploy**: push to `main` (the workflow runs after CI passes), or Actions >
   Deploy > Run workflow.
7. **Check it**: open the site (`extrudo.pages.dev` until the domain is attached); in the browser's developer tools the Console
   should be free of red lines, `crossOriginIsolated` should be `true`, and the
   Network tab should show `sw.js` with `cache-control: no-cache`.

### Three addresses: the landing page, app. and edge. (owner, ADR-0057)

From 2026-10-02 to the switch, `extrudo.org` served the app. To move to the
three addresses, once the first deploy after ADR-0057 has run (it creates the
Pages project `extrudo-site` and the `edge` deployment of `extrudo`):

1. **Save designs made at extrudo.org first** (browser storage is per address):
   open `https://extrudo.org`, and for each design File > Export `.extrudo`. Import
   them at `https://app.extrudo.org` after the switch.
2. Workers & Pages > `extrudo` > Custom domains: **remove** `extrudo.org` and
   `www.extrudo.org`, then **add** `app.extrudo.org`.
3. Workers & Pages > `extrudo-site` > Custom domains: **add** `extrudo.org` and
   `www.extrudo.org`.
4. **edge.extrudo.org**: Workers & Pages > `extrudo` > Custom domains > add
   `edge.extrudo.org`; then the extrudo.org domain > DNS > Records: edit the
   `edge` CNAME so its target is **`edge.extrudo.pages.dev`** (proxied). This is
   Cloudflare's way to give a branch deployment its own domain; without the edit
   it would show the production (stable) app.
5. Turn off **Web Analytics** automatic setup for both projects (or for the zone):
   it injects a script from `static.cloudflareinsights.com`, which the content
   policy blocks (a console error on every page).
6. Release v0.3.0: tag its commit, `git tag -a v0.3.0 -m "v0.3.0" 20a10bb && git
   push origin v0.3.0`, then GitHub > Actions > Deploy > **Run workflow** on main
   with target `stable` and ref `v0.3.0` (that commit predates the tag trigger:
   a tag runs the workflow file of the commit it names). Later releases deploy
   when their tag is pushed. Until then, `app.extrudo.org` serves the last
   production deployment of `extrudo`.
7. Check: `https://extrudo.org` shows the landing page and its video, its button
   opens `https://app.extrudo.org`; `https://edge.extrudo.org` is the app; a
   browser that used the app at `extrudo.org` shows the landing page after a
   reload or two (or after "A new version of Extrudo is ready" > Reload). `curl
   -sI https://extrudo.org/sw.js` and `https://app.extrudo.org/sw.js` show
   `cache-control: no-cache`.

### The domain extrudo.org (owner, done 2026-10-02)

`extrudo.org` is registered (2026-10-02, in Cloudflare; `extrudo.app` was taken).
How it was first attached (to the app; since ADR-0057 it serves the landing page,
see above):

1. Cloudflare: Workers & Pages > `extrudo` > Custom domains > **Set up a custom
   domain** > `extrudo.org`. The domain's DNS is on Cloudflare, so it adds the
   record itself.
2. If you want `www.extrudo.org` too: add it the same way (or a redirect rule
   from `www` to the apex), so there is one address people end up on.
3. **Set the zone's Browser Cache TTL to "Respect Existing Headers"** (the
   extrudo.org domain > Caching > Configuration, or
   `https://dash.cloudflare.com/?to=/:account/extrudo.org/caching/configuration`),
   then Purge Everything once. Its default of 4 hours overrides `_headers` for
   `.js` files on the custom domain (not on `pages.dev`), so `sw.js` arrived
   with `max-age=14400` and updates reached users up to 4 hours late. Done
   2026-10-02. Check: `curl -sI https://extrudo.org/sw.js` shows
   `cache-control: no-cache`.
4. Wait for the certificate (a few minutes), then open `https://extrudo.org` and
   run the checks in step 7 above.
5. Keep `extrudo.pages.dev` working, or redirect it: installed copies of the app
   (PWA) are tied to the address they were installed from, so the very first
   testers who installed from `pages.dev` keep using that until they reinstall.

### Mail for extrudo.org (owner)

Cloudflare **Email Routing** (the extrudo.org domain > Email > Email Routing)
forwards project addresses to the owner's own inbox; the inbox's address is
only in Cloudflare, never in this repository. Set up 2026-10-02:

- `conduct@extrudo.org`: the Code of Conduct's enforcement contact.
- DNS: three MX records (`route1`–`route3.mx.cloudflare.net`) and the SPF record
  `v=spf1 include:_spf.mx.cloudflare.net ~all`, added by "Add records and
  enable". Check with `dig +short MX extrudo.org`.
- It only receives: a reply goes out from the owner's own address. Add more
  addresses (`hello@`…) the same way; leave the catch-all off.

## How the workflow behaves

`.github/workflows/deploy.yml`:

- **Triggers:** the `CI` workflow finishing for a push to `main` (`workflow_run`),
  only when it **succeeded**: deploys edge and the landing page from the exact
  commit CI tested. A pushed tag `v*`: deploys the stable app, and fails (deploys
  nothing) unless CI succeeded for that commit on main. "Run workflow" on `main`:
  target `edge-and-site` (the head of main) or `stable` (the commit named by
  `ref`, default main; refused unless its CI passed on main).
- **Gate:** the `plan` job checks that both secrets exist. Without them it prints
  a notice ("Deploy skipped") and the deploy jobs don't run; the run is green.
  Forks never have the secrets, so they skip too.
- **Build:** `pnpm install --frozen-lockfile`, then `pnpm build` (which first
  downloads the WASM builds CI published for this commit's inputs) for the app,
  `pnpm --filter @extrudo/site build` for the landing page.
- **Deploy:** a pinned wrangler through `npx`: `wrangler pages deploy
  apps/web/dist --project-name=extrudo --branch=edge` (or `--branch=main` for
  stable), and `apps/site/dist --project-name=extrudo-site --branch=main`. One
  deployment at a time. (Not `cloudflare/wrangler-action`: in a pnpm workspace it
  tries `pnpm add wrangler` in the root, which pnpm refuses.)
- It creates the project `extrudo-site` if it is missing, and never the secrets,
  the token or the custom domains.

## Rolling back

Cloudflare keeps every deployment: Workers & Pages > `extrudo` (or
`extrudo-site`) > Deployments > the old one > "Rollback to this deployment"; for
the stable app, a rollback of the production deployment. Users get the older
version at their next visit; their browser keeps the newer service worker until
it finds the older one, so a rollback can take a reload or two to reach
everyone.

## When an update reaches users

A repeat visitor already runs the cached app. The browser checks `sw.js` on
every navigation (and the page asks once an hour); a changed one installs in the
background and the app shows "A new version of Extrudo is ready. Reload". The
reload saves open designs first. Nobody is switched over while working.
