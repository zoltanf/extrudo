# Deploying the web app

The hosted demo is a static site on **Cloudflare Pages**, deployed from GitHub
Actions. The decision and what was rejected are in
[ADR-0054](adr/0054-public-release.md). Nothing here has been done yet: every
step in "One-time setup" is the owner's, and until the secrets exist the deploy
workflow skips itself.

## What gets deployed

`apps/web/dist`, the output of `pnpm build`. It is plain static files: the app,
the two WASM files, `sw.js` (the offline service worker) and `_headers`.

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

The site's public address appears in the canonical link and the Open Graph tags
of `index.html`. It comes from `SITE_URL` at build time and defaults to
`https://extrudo.org` (`apps/web/pwa/site.ts`); set the repository variable
`SITE_URL` only to use another address (a fork, a staging site).

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

### The domain extrudo.org (owner)

`extrudo.org` is registered (2026-10-02, in Cloudflare; `extrudo.app` was taken).
The builds already name it in the canonical link and the Open Graph tags. To
make it serve the app:

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

## How the workflow behaves

`.github/workflows/deploy.yml`:

- **Trigger:** the `CI` workflow finishing for a push to `main`
  (`workflow_run`), and only when it **succeeded**. It checks out the exact
  commit CI tested. "Run workflow" on `main` redeploys the head of `main`.
- **Gate:** the first step checks that both secrets exist. Without them it
  prints a notice ("Deploy skipped") and every other step is skipped; the run
  is green. Forks never have the secrets, so they skip too.
- **Build:** `pnpm install --frozen-lockfile`, then `pnpm build`, which first
  downloads the WASM builds CI published for this commit's inputs.
- **Deploy:** a pinned wrangler through `npx` runs `wrangler pages deploy
  apps/web/dist --project-name=extrudo --branch=main`. One deploy at a time.
  (Not `cloudflare/wrangler-action`: in a pnpm workspace it tries `pnpm add
  wrangler` in the root, which pnpm refuses.)
- It never creates the project, the secrets or the token.

## Rolling back

Cloudflare keeps every deployment: Workers & Pages > extrudo > Deployments >
the old one > "Rollback to this deployment". Users get the older version at
their next visit; their browser keeps the newer service worker until it finds
the older one, so a rollback can take a reload or two to reach everyone.

## When an update reaches users

A repeat visitor already runs the cached app. The browser checks `sw.js` on
every navigation (and the page asks once an hour); a changed one installs in the
background and the app shows "A new version of Extrudo is ready. Reload". The
reload saves open designs first. Nobody is switched over while working.
