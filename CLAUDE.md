# Extrudo — agent context

Open-source, browser-based parametric CAD for the 3D-printing community, with a
Fusion 360-style workflow (sketch → features → timeline, parameters everywhere)
and a playful modern UI. Web first (PWA). An Electron desktop build comes later
from the same codebase.

**Status (2026-09-25):** P0-01 done (monorepo, toolchain, CI, hello page).
Next tasks, which can run in parallel: **P0-02** (kernel spike), **P0-03**
(solver spike), **P0-04** (design system and shell), **P0-06** (document
model), **P0-08** (storage). See `docs/03-roadmap.md`.

## Commands

```sh
pnpm install      # after pulling
pnpm dev          # app at http://localhost:5173
pnpm check        # typecheck + Biome + package boundaries + Vitest. Must pass.
pnpm e2e          # build + Playwright (run `pnpm e2e:install` once)
pnpm format       # Biome auto-fix
```

Package dependency rules live in `scripts/check-boundaries.mjs` (run by
`pnpm lint`). Add every new workspace package there. `packages/io` is MIT and
must never depend on the GPL packages.

## Read first

| Doc | What |
|---|---|
| `docs/01-requirements.md` | Vision, principles, functional requirements (IDs like FR-SK-07), NFRs, benchmark models B1–B10 |
| `docs/02-architecture.md` | Stack, package layout, document model, kernel worker, topological naming, storage, file format, testing |
| `docs/03-roadmap.md` | Phases, tasks with acceptance criteria, risks, open decisions. **Tick tasks here.** |
| `docs/04-ui-spec.md` | Layout, interactions, sketch mode, shortcuts, error-message style |
| `docs/05-brand.md` | Logo, colour tokens (Slate dark default + light), type, icon brief, voice. Logo SVGs in `docs/brand/` |
| `docs/references.md` | Other open-source projects we looked at, what to borrow from each, and their licenses |
| `docs/adr/` | Architecture decision records (created as decisions are made) |

## Stack summary

TypeScript strict · pnpm monorepo · Vite · React 19 · Radix + Tailwind v4 ·
Zustand + Immer · Zod · three.js via @react-three/fiber + drei ·
OCCT WASM (`libcascade`) in a Web Worker via Comlink · planegcs sketch solver ·
Vitest + Playwright · Biome. Desktop later: Electron.

## Hard rules

- **The document is JSON; geometry is derived.** Never store kernel shapes as
  the source of truth.
- **Every document change goes through a command** (undoable). No direct store
  mutation from components.
- **The kernel runs only in the worker.** The UI thread never calls OCCT.
- **OCCT objects must be disposed of** (disposal scope / `using`). Leaks are bugs.
- **Face and edge references use the topological-naming service**, never raw
  indices.
- **Platform APIs** (files, storage, dialogs, slicer launch) go through
  `apps/web/src/platform/` interfaces. This keeps the Electron port cheap.
- **Every numeric input is an `<ExpressionInput>`** (expressions and
  parameters, with units).
- **Fusion 360 is a conceptual reference only.** Never copy its code, icons,
  images, text or branding.
- `packages/core` has no DOM and no WASM. `packages/kernel` and
  `packages/sketch` must run in Node (for tests and the CLI).

## Workflow per task

1. Take the next unchecked roadmap task whose dependencies are done.
2. Implement it with tests. `pnpm check` must pass, plus `pnpm e2e` if UI flows
   changed.
3. Tick the task in the roadmap, add a line to `docs/CHANGELOG.md`, and write
   an ADR for any significant decision. Record rejected approaches too.

## Environment notes

- Node 26 and pnpm 12 come from mise (`~/.config/mise/config.toml`). CI uses
  Node 24 LTS; `engines.node` is `>=24`.
- **pnpm 12 refuses packages published less than a day or so ago**
  (`minimumReleaseAge`). If an install adds a `minimumReleaseAgeExclude` entry
  to `pnpm-workspace.yaml`, don't keep it: relax the version range (e.g.
  `^8.3.0` instead of `^8.3.1`) so pnpm picks an older release.
- **Playwright `webServer` must not start through pnpm.** `pnpm --filter …
  preview` and `pnpm exec` leave Vite running after the tests, and the run
  never ends. The config starts `node node_modules/vite/bin/vite.js` with
  `cwd: 'apps/web'`, bound to `127.0.0.1` (Vite otherwise binds IPv6 `::1`
  only while Playwright polls IPv4).
- **`biome migrate` rewrote `"recommended": true` into `"preset": "none"`**,
  which silently disables all rules. The config uses `"preset": "recommended"`.
- Playwright's own Chromium headless shell works on Arch. If it ever breaks,
  set `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium`.
- Don't use `pkill -f <pattern>` in a compound shell command: the pattern
  matches the shell itself and kills it. Kill by PID or port instead.
- This project is intended to become **public open source**. Unlike the rest
  of `~/Work`, it must never contain credentials, home-network details or
  personal data.
