# Recorded and generated assets

The pictures, clips and pages in this repository that are made by a script from
the real app, not by hand: what each one is, the command that redoes it, and
when to run it. They are all committed, so a change to the UI does not update
them by itself.

## Before you start

The recordings drive the built app in headless Chromium (Playwright), so they
need the WASM and a build:

```sh
pnpm install
pnpm wasm         # OCCT, planegcs and OpenSCAD WASM (once per input change)
pnpm e2e:install  # Playwright's Chromium (once)
```

`pnpm demos` builds the app first; pass `--skip-build` when `apps/web/dist` is
current. Useful variables:

| Variable | What it does |
|---|---|
| `E2E_GPU=1` | Real GPU rendering: faster recordings. Without it Chromium renders in software (the shots hide the status bar's renderer and frame rate either way). Local runs only. |
| `E2E_PORT=4391` | Another port for the preview server, when 4173 is taken (another worktree running e2e). |
| `PLAYWRIGHT_CHROMIUM_PATH` | A system Chromium, on the Ubuntu machine `/usr/bin/google-chrome-stable`. |

## What there is

| Asset | Where | Command | Redo when |
|---|---|---|---|
| **README screenshots**: 8 scenes, light and dark theme, WebP | `docs/images/readme/` | `E2E_GPU=1 pnpm demos -g readme` | The look of the app changed (toolbar, panels, colours, templates), before a release |
| **Tooltip clips** of the toolbar tools, WebM | `apps/web/public/demos/` | `pnpm demos` (or one: `pnpm demos -g "demo: fillet"`) | A tool's UI or behaviour changed |
| **Template thumbnails** on the home screen | `apps/web/src/home/templates/` | `pnpm demos -g thumbnail` | A template changed |
| **Example pictures** for the guide's gallery | `docs/guide/images/examples/` | `pnpm demos -g example` | An example in `fixtures/examples/` changed |
| **Concept guide pictures** | `docs/guide/images/<page>/` | `pnpm demos -g guide` | The UI shown on a guide page changed |
| **Tutorial pictures**, one per step | `docs/guide/tutorials/images/<name>/` | `pnpm demos -g tutorials` | A tutorial or the UI it walks through changed |
| **Tool reference pages** and the examples page | `docs/guide/tools/`, `docs/guide/examples.md` | `pnpm docs:generate` | A tool, its key or its clip changed (a test fails when they are stale) |
| **API methods and pages** | `packages/api/src/generated/`, `docs/api/features/` | `pnpm api:generate` | A feature input changed (a test fails when they are stale) |

The `-g` value after `pnpm demos` is a Playwright `--grep` on test names, except
`readme`, `guide` and `tutorials`, which pick their own spec files.

## Redoing the README screenshots

1. Pull `main` and run, on a machine with a GPU:

   ```sh
   E2E_GPU=1 pnpm demos -g readme
   ```

   About 2 minutes. It writes `docs/images/readme/<scene>-light.webp` and
   `<scene>-dark.webp` for: home, model, drawing, sketch, fillet, assembly,
   print and customizer (`e2e/readme-shots.spec.ts`).
   One scene alone: `pnpm demos -g readme --skip-build -g drawing`.
2. Look at every picture: no tooltip or menu left open, the model fills the
   view, both themes look right. `git diff --stat` shows which changed.
3. Commit them with a line in `docs/CHANGELOG.md`.

To add a scene: add an entry to `scenes` in `e2e/readme-shots.spec.ts` (it is
recorded in both themes by itself), then a row in the README's table. The
spec's selectors and traps are in `docs/agent/e2e-notes.md`.

## Checking before committing

- Look at each changed picture or clip; the recordings succeed even when a
  dialog covers the view.
- Sizes: tooltip clips fail a test above 150 kB each, and above 4 MB in all
  (`apps/web/src/onboarding/demos.test.ts`); guide and tutorial PNGs are
  256-colour to stay near 150 kB; README WebPs are about 45–75 kB.
- `pnpm check` must pass: it includes the staleness tests for the generated
  pages and the tutorial/picture match (`apps/site/src/tutorials.test.ts`).

## Background

ADR-0052 (onboarding: clips and thumbnails) and ADR-0080 (docs, tutorials and
examples) explain why these are recorded from the real app.
`scripts/record-demos.mjs` has the details of the recorder.
