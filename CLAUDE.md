# Extrudo — agent context

Open-source, browser-based parametric CAD for the 3D-printing community, with a
parametric, timeline-based workflow (sketch → features → timeline, parameters
everywhere) and a playful modern UI. Web first (PWA), plus an Electron desktop
app built from the same source.

**Repo:** <https://github.com/zoltanf/extrudo>. **Public** since 2026-10-04. CI
runs on every push and pull request, on GitHub-hosted runners (a self-hosted
backup exists, off by default: `docs/deploy.md`).

This file is kept short on purpose: it is loaded into every session. Detail
lives in the docs below; read the part you need, and **put new detail there,
not here** (a new ADR's rules go into `docs/agent/adr-digest.md`, a new e2e
spec's selectors into `docs/agent/e2e-notes.md`).

## Status

Phases 0, 1, 2, 3 and 5 are complete. Phase 4 is complete apart from **P4-12's
remaining backlog** (the open items in `docs/03-roadmap.md`). Phase 6 has
P6-08 (the desktop MCP server) and P6-04 (i18n, **deferred**: English only for
now) left. Phase 7 (IK) is last, lowest priority. The
owner's UI review 3 is done (`docs/plans/ui-review-2026-10-11.md`); tooltip
clips for Construct, 3D Print and the Sketch tab follow in later batches.

Releases: v0.4.0 was the first public one; v0.4.1, v0.5.0 (2026-10-10), v0.6.0
and **v0.6.1** (2026-10-12) followed. **The owner tags** (`docs/release-checklist.md`;
never tag yourself). Tasks may run in parallel on separate branches and
worktrees, merged to main one at a time.

## Where things are documented

| Doc | What |
|---|---|
| `docs/01-requirements.md` | Vision, principles, functional requirements (IDs like FR-SK-07), NFRs, benchmark models B1–B10 |
| `docs/02-architecture.md` | Stack, package layout, document model, kernel worker, topological naming, storage, file format, testing |
| `docs/03-roadmap.md` | Phases, tasks with acceptance criteria, risks, open decisions. **Tick tasks here.** |
| `docs/04-ui-spec.md` | Layout, interactions, sketch mode, shortcuts, error-message style |
| `docs/05-brand.md` | Logo, colour tokens, type, icon brief, voice. Logo SVGs in `docs/brand/` |
| `docs/file-format.md` | The `.extrudo` file and document JSON, field by field. A test fails when the schema gets a key the doc lacks. **Update it with any schema change.** |
| `docs/adr/` | Architecture decision records, one per decision (0001 kernel … 0084 `.f3d` file bodies), with amendments |
| **`docs/agent/adr-digest.md`** | One paragraph per ADR: the files involved and **the rules a change must keep**. Read the paragraphs for the area you touch before changing it (`grep -n "ADR-0047" docs/agent/adr-digest.md`) |
| **`docs/agent/e2e-notes.md`** | Per spec: regions, data attributes, selectors, picking coordinates and traps. Read before writing or fixing an e2e spec |
| **`docs/agent/dev-environment.md`** | The two dev machines (Arch workstation, Ubuntu machine), OCCT/planegcs WASM builds and CI, the facade, Docker harnesses, fuzzing, and OCCT/planegcs/library facts |
| `docs/deploy.md`, `docs/release-checklist.md`, `docs/desktop.md` | Hosting, releases, the desktop app |
| `docs/assets.md` | Recorded and generated assets (README screenshots, tooltip clips, guide and tutorial pictures, generated pages): the command for each and when to redo it |
| `docs/cli.md`, `docs/api/`, `docs/plugins.md`, `docs/guide/` | The CLI, the document API, plugins, the user guide |
| `docs/references.md` | Other open-source projects we looked at and their licenses |

## Commands

```sh
pnpm install      # after pulling
pnpm dev          # app at http://localhost:5173
pnpm check        # typecheck + Biome + package boundaries + license allow-list + Vitest. Must pass.
pnpm e2e          # build + Playwright (run `pnpm e2e:install` once)
pnpm format       # Biome auto-fix
pnpm wasm         # download the OCCT, planegcs and OpenSCAD WASM for the current inputs (check/dev/build do this)
pnpm occt build   # build OCCT locally with Docker (~11 min; Arch workstation only); see packages/kernel/occt/README.md
pnpm planegcs build  # build planegcs locally with Docker (~2 min; Arch workstation only)
pnpm openscad build  # download OpenSCAD's pinned WASM snapshot (ADR-0071; no Docker)
pnpm api:generate   # rewrite @extrudo/api's generated methods and docs/api pages (ADR-0068)
pnpm docs:generate  # rewrite docs/guide/tools/ from the app's tool list (ADR-0080)
pnpm extrudo        # the headless CLI: info, export, set, check (ADR-0069)
pnpm demos          # record tooltip clips, template and tutorial pictures (ADR-0052, ADR-0080)
pnpm --filter @extrudo/desktop dev       # the Electron app (ADR-0075)
pnpm --filter @extrudo/desktop build     # into apps/desktop/out
pnpm --filter @extrudo/desktop package   # unsigned installers into apps/desktop/release
```

Package dependency rules live in `scripts/check-boundaries.mjs` (run by
`pnpm lint`). Add every new workspace package there. `packages/io` is MIT and
must never depend on the GPL packages.

## Stack summary

TypeScript strict · pnpm monorepo · Vite · React 19 · Radix + Tailwind v4 ·
Zustand + Immer · Zod · three.js via @react-three/fiber + drei ·
OCCT WASM (`libcascade`) in a Web Worker via Comlink · planegcs sketch solver ·
QuickJS (scripts, plugins) · manifold-3d (mesh bodies) · Electron (desktop) ·
Vitest + Playwright · Biome.

## Hard rules

- **The document is JSON; geometry is derived.** Never store kernel shapes as
  the source of truth.
- **Every document change goes through a command** (undoable). No direct store
  mutation from components. Recipes are deterministic: create IDs with
  `newId()` in the caller and pass them in the payload.
- **Every parameter or dimension write goes through the shell's `apply` /
  `ToolHost.apply`**, which re-solves the affected sketches in the same undo step.
- **The kernel runs only in the worker.** The UI thread never calls OCCT.
- **OCCT objects must be disposed of.** Leaks are bugs: an evaluator releases
  every shape it doesn't return (`kernel.scope()`, `ShapeScope.keep` only after
  the last thing that can throw). Heavy OCCT work goes through our C++ facade
  (ADR-0001); never expose an OCCT type in a facade method.
- **Face and edge references use the topological-naming service** (`ctx.resolve`),
  never raw indices; throw `LostReferenceError` for anything an evaluator can't find.
- **Platform APIs** (files, storage, dialogs, slicer launch) go through
  `apps/web/src/platform/` interfaces.
- **Every numeric input is an `<ExpressionInput>`** (expressions and
  parameters, with units).
- **No cross-origin loads and no string evaluation** in the app: it runs under
  COOP/COEP and a CSP without `'unsafe-eval'` (`apps/web/public/_headers`,
  `e2e/hosting.spec.ts`). Import zod only through core's `zod.ts`.
- **A new dependency with a new license** needs the allow-list
  (`scripts/check-licenses.mjs`) and `NOTICE`.
- **A new feature input needs a `.describe()`** and a run of `pnpm api:generate`;
  a new body-making feature needs its face roles (ADR-0068).
- **Never two files whose names differ only by case** (breaks macOS/Windows builds).
- **Other CAD tools are conceptual references only.** Never copy their code,
  icons, images, text or branding. Never name the vendor of the `.f3d` format
  or its products anywhere in the repository (code, docs, commit messages, PR
  text): say "f3d" or "the file".
- `packages/core` has no DOM and no WASM. `packages/kernel` and
  `packages/sketch` must run in Node (for tests and the CLI).
- The repository is public: never commit credentials, home-network details
  (hostnames included) or personal data.

## Workflow per task

1. Take the next unchecked roadmap task whose dependencies are done.
2. Read the ADR digest's paragraphs for the area, and the e2e notes for the
   specs you will touch.
3. Implement it with tests. `pnpm check` must pass, plus `pnpm e2e` (or the
   affected specs, and CI) if UI flows changed.
4. Tick the task in the roadmap, add a line to `docs/CHANGELOG.md`, write an ADR
   for any significant decision (rejected approaches too), and add its rules to
   `docs/agent/adr-digest.md`.

## Environment, in brief

Two dev machines: check which first (`grep ^ID= /etc/os-release`). The Arch
workstation builds OCCT/planegcs with Docker and makes screenshot baselines; on
the Ubuntu machine build WASM through CI (`gh workflow run ci.yml --ref
<branch>`), take baselines from CI's artifacts, run one e2e at a time with
`--workers=2` and `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable`.
Everything else (WASM not in git, facade checks, harnesses, fuzzing, heap,
library quirks) is in `docs/agent/dev-environment.md`.
