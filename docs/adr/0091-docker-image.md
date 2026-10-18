# ADR-0091: A Docker image of the app, published to GitHub's container registry

- **Status:** Accepted, 2026-10-18 (the owner's decision after a user asked for a
  self-hosted container; options 1 and 2.1 of the plan in this record)
- **Task:** P6-11 (Phase 6: "Docker image").
- **Builds on:** ADR-0054 (hosting: static files, `_headers`, the CSP),
  ADR-0057 (the three addresses), ADR-0085 (versions and channels), PR #65
  (the app runs over plain HTTP; `docs/deploy.md`, "Serving the app yourself").

## Context

A Reddit user asked for "a docker container to run it yourself", and the owner
answered that one would come with the releases. The app is already plain static
files (`apps/web/dist`: the app, three WASM files, `sw.js`, `_headers`, about
42 MB), served by Cloudflare Pages with the response headers of
`apps/web/public/_headers`. Nothing runs on a server. So a container is a web
server with those files and the same headers; the work is in the packaging,
the publishing and the docs, not in the app.

## Decision

### 1. Where: `ghcr.io/zoltanf/extrudo`, GitHub's container registry

The image is published to **GitHub Container Registry (GHCR)** under the
repository's owner, as `ghcr.io/<owner>/extrudo` (the owner and name come from
`github.repository`, lower-cased, so a fork publishes under its own owner).
GHCR is free for a public repository, the workflow pushes with the built-in
`GITHUB_TOKEN` (`packages: write`; no new account, no new secret), and the
package shows on the repository's page. **Owner step after the first push:**
check that the package is public and linked to the repository (the owner's
Packages page > `extrudo` > Package settings); a package made by a workflow of
a public repository should inherit its visibility, but verify once.

Rejected for now: **Docker Hub** (`zoltanf/extrudo`): another account, an
access-token secret, anonymous pull rate limits. Can be added later as a
second push target in the same job if people look for it there.

### 2. What: a thin image, nginx and the built files, the app only

```dockerfile
FROM nginx:<pinned minor>-alpine
COPY docker/nginx/ /etc/nginx/...
COPY apps/web/dist/ /usr/share/nginx/html/
```

- **The same build as app.extrudo.org.** The workflow builds `apps/web/dist`
  the way the Pages deploy does (`pnpm build` with `EXTRUDO_CHANNEL` set, so
  the About dialog shows the version and channel; `SITE_URL` stays the public
  app's address, since the canonical link and the Open Graph tags should name
  the public app, not someone's LAN address) and copies it into the image.
  Locally, `pnpm build && docker build -t extrudo .` makes the same image.
- **Not a multi-stage build from source** inside Docker (Node, pnpm, the WASM
  download, Vite). It would duplicate CI's build at every architecture, take
  minutes per architecture under emulation, and nobody needs it: people who
  pull the image never build, and people who build Extrudo use pnpm anyway.
- **The app only.** The landing page (`apps/site`) is extrudo.org's and has
  no business on a user's NAS.
- **nginx, Alpine variant**, port **80** inside the container (`-p 8080:80`).
  Pinned to a minor version (`nginx:1.x-alpine`) and bumped by hand like the
  other pinned actions; nginx's `mime.types` serves `.wasm` as
  `application/wasm`, which streaming compilation needs.
- **Multi-architecture: `linux/amd64` and `linux/arm64`** (Raspberry Pi, ARM
  NAS boxes, Apple Silicon). The Dockerfile has no `RUN` step, so buildx makes
  the second architecture by copying the same files onto the arm64 base image;
  no emulation is needed.

### 3. The headers come from `_headers`, generated, never copied by hand

`apps/web/public/_headers` stays the one source of the response headers
(ADR-0054): COOP/COEP, the CSP, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `Cache-Control: no-cache` for `/`, `/index.html`,
`/sw.js` and `/manifest.webmanifest`, a year `immutable` for `/assets/*`.

A script, `scripts/nginx-headers.mjs`, reads the file with the existing parser
(`apps/web/pwa/headers.ts`) and writes nginx configuration into
`docker/nginx/` (committed). A Vitest test regenerates and compares, so the
committed files cannot drift from `_headers`; its failure message names the
script to run. The script supports exactly what the file uses (ADR-0054's
parser does the same): the `/*` rule becomes `add_header … always;` lines, and
every other rule becomes an entry of a `map $uri $…` per header name (exact
paths, and `~^<prefix>` for a trailing `*`), emitted by one `add_header <Name>
$<variable> always;` so that nginx sends the header only where the map gives a
value. The maps are the reason `Cache-Control` is not set with `add_header`
inside `location` blocks: an `add_header` in a `location` **replaces** every
`add_header` of the enclosing levels, so the security headers would disappear
from exactly the paths that set a cache rule.

Unknown paths serve `index.html` (Cloudflare Pages does the same for a site
without a `404.html`); gzip is on for text, JavaScript, JSON and WASM.

### 4. When: the deploy workflow publishes, CI proves the image builds

- **`.github/workflows/ci.yml`** gets a job **Docker image** that builds the
  image for the runner's architecture from a fresh `pnpm build`, starts it and
  runs the smoke script (`scripts/docker-smoke.sh`: `/`, `/sw.js`, the
  manifest, one `/assets/` file and one `.wasm` answer 200 with the headers
  `_headers` gives that path and the right `Content-Type`; an unknown path
  gets `index.html`). It pushes nothing. So a pull request that breaks the
  Dockerfile or the nginx configuration turns CI red.
- **`.github/workflows/deploy.yml`** gets a job **Docker image** beside the
  Pages jobs, with the same `plan` gate (a green CI run on main → the `edge`
  tag; a `v*` tag whose commit passed CI on main → `X.Y.Z`, `X.Y` and
  `latest`; the manual `stable` target with a `ref` → the version tags of that
  commit). It does **not** depend on the Cloudflare secrets: a fork without
  them still publishes its image. It builds with `docker/build-push-action`
  for both architectures, runs the smoke script on the native image before the
  push, and labels the image with `docker/metadata-action` (source, revision,
  version, licence).
- The release checklist gains the pull command in the notes and a check after
  publishing (`docker pull ghcr.io/zoltanf/extrudo:X.Y.Z` works, the About
  dialog in it shows the version).

### 5. What users get, and the limits they should know

`docker run -d -p 8080:80 ghcr.io/zoltanf/extrudo` (or `docker/compose.yml`),
then `http://<host>:8080`. Documented in `docs/deploy.md` ("Self-hosting with
Docker") and in the README's "Try it":

- Over **plain HTTP on a LAN address** the browser gives the page no secure
  context: no service worker (no offline use, no "install as app"), designs
  in IndexedDB instead of OPFS (PR #65). `http://localhost:8080` counts as
  secure. Behind the user's own TLS reverse proxy (Caddy, Traefik, Nginx
  Proxy Manager) everything works as at app.extrudo.org; the proxy must pass
  the responses' headers through (they all do by default).
- Designs live in the browser's storage **per address**, as with the hosted
  app; moving between addresses means exporting `.extrudo` files.
- No telemetry, no outbound requests: the CSP allows the image's own origin
  only, so it works on a network without internet access once pulled.
- `edge` tracks main and can break; `latest` is the last release.

## Consequences

- One more job in CI (about five minutes, parallel) and in the deploy workflow;
  nothing changes for the Pages deploys.
- Two committed, generated files under `docker/nginx/` with a drift test, the
  same pattern as the generated API and tool docs (ADR-0068, ADR-0080).
- The Dockerfile at the repository root makes `docker build .` work after
  `pnpm build`; `.dockerignore` keeps the context to `apps/web/dist` and
  `docker/`.
- Changes to `_headers` now also need `node scripts/nginx-headers.mjs`
  (the test says so).
