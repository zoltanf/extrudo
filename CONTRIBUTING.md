# Contributing to Extrudo

Thanks for wanting to help. Extrudo is a parametric CAD app for 3D printing
that runs in the browser. This page covers how to set up, how work is planned
and reviewed, and the rules that keep the codebase healthy. By taking part you
agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug.** The most useful report has the steps, your browser and
  system, any console errors, and the design itself: **File > Export** writes a
  `.extrudo` file you can attach. A design that makes the kernel fail or the
  sketch solver give a wrong answer is worth a lot.
- **Suggest a feature.** Check [`docs/01-requirements.md`](docs/01-requirements.md)
  and [`docs/03-roadmap.md`](docs/03-roadmap.md) first: it may be planned already,
  and the requirement ID (like `FR-SK-07`) is the best way to refer to it.
- **Fix something or build a roadmap task.** Say so in an issue first for
  anything bigger than a small fix, so we do not build the same thing twice.
- **Improve the docs, translations of ideas, or the tutorial.** Equally welcome.

## Setting up

You need Node 24 or newer and pnpm 12.

```sh
git clone https://github.com/zoltanf/extrudo.git
cd extrudo
pnpm install
pnpm dev          # the app at http://localhost:5173
```

`pnpm dev`, `pnpm build` and `pnpm check` first run `pnpm wasm`, which downloads
the two WASM builds (the OpenCascade kernel and the sketch solver) that match
the files in your checkout. They are not in git; CI builds each new version
once and publishes it as a GitHub release. Downloading uses the
[GitHub CLI](https://cli.github.com/) when it is installed (`gh auth login`)
and a plain HTTPS download otherwise.

**If you change the C++ facade, the OCCT build config, the planegcs build
script or its patch**, the WASM you need does not exist yet. Push your branch
and let CI build it (`gh workflow run ci.yml --ref <your-branch>`; about 15
minutes for OpenCascade), or build it yourself with Docker (`pnpm occt build`,
`pnpm planegcs build`). Details are in
[`packages/kernel/occt/README.md`](packages/kernel/occt/README.md) and
[`packages/sketch/planegcs/README.md`](packages/sketch/planegcs/README.md).

### Checks

| Command | What it does |
|---|---|
| `pnpm check` | Typecheck, Biome, package boundaries, binding check and all unit tests. **Must pass** before a pull request. About 8 minutes. |
| `pnpm format` | Fixes formatting and lint problems Biome can fix. |
| `pnpm e2e:install` | Once: downloads Playwright's Chromium. |
| `pnpm e2e` | Builds the app and runs the Playwright end-to-end tests. Needed when you change a UI flow. Run a single spec while you work: `node node_modules/@playwright/test/cli.js test e2e/fillet.spec.ts`. |

Use the `node node_modules/@playwright/test/cli.js` form rather than going
through pnpm for Playwright: pnpm does not pass the stop signal on to the
preview server, and the run never ends.

## How work is planned

The plan lives in the repository.

- [`docs/03-roadmap.md`](docs/03-roadmap.md) lists tasks (`P3-04` and so on)
  with acceptance criteria. Pick one that is not ticked and whose dependencies
  are done.
- [`docs/adr/`](docs/adr/) holds **architecture decision records**. A change
  that makes a significant decision (a new dependency, a data-model change, a
  different approach to a problem) comes with an ADR, including the options you
  rejected, so nobody retries them. Look at a recent one for the shape.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) gets one line per finished task.
- [`docs/file-format.md`](docs/file-format.md) describes the `.extrudo` file.
  **Update it with any schema change**; a test fails when the schema gets a key
  the document does not describe.

A pull request for a roadmap task therefore touches: the code and its tests,
the roadmap tick, a CHANGELOG line, and an ADR when there was a decision.

## Rules that keep Extrudo working

These come from how the app is built. Reviewers will ask for them.

1. **The document is JSON; geometry is derived.** Never store kernel shapes as
   the source of truth.
2. **Every change to the document goes through a command**, so it is undoable.
   No direct store changes from components. Commands are deterministic: create
   IDs with `newId()` in the caller and pass them in.
3. **The kernel runs only in the worker.** The UI thread never calls
   OpenCascade.
4. **Dispose of OpenCascade objects.** Leaks are bugs; the memory tests catch
   them. Heavy OpenCascade work goes through the C++ facade, because freeing
   from JavaScript often does not release what the C++ object owns. Do not
   expose an OpenCascade type in a facade method.
5. **References to faces, edges and vertices use the topological-naming
   service**, never raw indices. Evaluators resolve them with `ctx.resolve`.
6. **Files, storage, dialogs and similar go through `apps/web/src/platform/`**,
   so a desktop build stays cheap.
7. **Every numeric input is an expression input** (expressions, parameters and
   units).
8. **Keys are declared only in `commands/keymap.ts`**, and a new command goes in
   `buildCommands`.
9. **Package boundaries** are enforced by `scripts/check-boundaries.mjs`
   (`pnpm lint`). `packages/core` has no DOM and no WASM; `packages/kernel` and
   `packages/sketch` run in Node too. Add a new workspace package to the script.
10. **Our own look.** Extrudo borrows concepts and workflow from other CAD tools,
    never their code, icons, images, text or branding. Do not paste any of
    that into a contribution.
11. **No secrets, personal data or private network details** in code, docs,
    fixtures or screenshots.

## Code style

- TypeScript in strict mode, React function components, Zustand for stores.
- [Biome](https://biomejs.dev/) formats and lints: single quotes, 100
  columns, two-space indent. `pnpm format` fixes most things; `pnpm check`
  fails on the rest.
- Prefer small pure functions you can test without a browser. Put logic in the
  packages, keep components thin.
- Write user-facing text the way the brand voice does ([`docs/05-brand.md`](docs/05-brand.md)
  section 7): short, plain, friendly, say what happened and how to fix it. Error
  messages follow [`docs/04-ui-spec.md`](docs/04-ui-spec.md).
- Comments say why, not what. A decision worth explaining goes in an ADR.

## Tests

- Unit tests (Vitest) sit beside the code, `*.test.ts`. Kernel features have
  golden tables you update with `pnpm vitest run -u <path>`; review the diff.
- End-to-end tests (Playwright) live in `e2e/`. They read the app through
  `data-*` attributes and accessible names, never through screenshots alone.
- **Screenshot baselines** (`e2e/*-snapshots/`) must match CI, which renders in
  the Playwright Ubuntu image. If you change something visible, regenerate them
  in that image and commit only the real changes:
  ```sh
  pnpm build
  docker run --rm --ipc=host -e CI=1 -v "$PWD":/work -w /work \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    mcr.microsoft.com/playwright:v1.63.0-noble \
    node node_modules/@playwright/test/cli.js test e2e/shell.spec.ts e2e/storage.spec.ts \
    --update-snapshots=all
  ```
  (`--update-snapshots=all`, not plain `--update-snapshots`: the latter only
  rewrites shots that already fail.) If you cannot run Docker, say so in the
  pull request and take the new images from the CI run's `playwright-report`
  artifact.
- Anything that shows up in the UI gets an accessibility check: `e2e/a11y.spec.ts`
  runs axe on the main screens in both themes.

## Commits and pull requests

- One logical change per commit. Start the subject with the task ID when there
  is one (`P3-04 Hole (ADR-0049)`), in the imperative, under about 70
  characters. Say why in the body when it is not obvious.
- Branch from `main`; open the pull request against `main`. CI runs the checks
  and the end-to-end suite on every pull request.
- Fill in the pull request template: the task or issue, the ADR if any, what
  you tested, and screenshots for anything visible.
- Keep a pull request small enough to review. A task that needs more than about
  1,500 changed lines is split first.
- Be ready to change things. Review is about the code, never about you.

### AI-assisted contributions

Parts of this project were written with AI coding assistants, and
contributions made with them are welcome under the same rules as any other:
you are the author of what you submit, you have read and understood it, the
tests pass, and it does not copy code or assets you have no right to. Review
is the same for everyone.

## Licenses

By contributing you agree that your contribution is licensed under the same
terms as the part of the project it changes:

- The app and most packages are under the **GNU GPL v3.0 or later**
  ([`LICENSE`](LICENSE)).
- **`packages/io`** ([`packages/io/LICENSE`](packages/io/LICENSE)) and the
  **file-format specification** ([`docs/file-format.md`](docs/file-format.md))
  are under the **MIT license**, so other tools can read and write Extrudo files.
  `packages/io` must never depend on the GPL packages.
- The C++ facade (`packages/kernel/occt/facade/`) and our planegcs patch are
  under the LGPL-2.1-or-later, like the libraries they are built into.

Third-party code and assets you add must be compatible with GPL-3.0-or-later and
get an entry in [`NOTICE`](NOTICE). [`docs/references.md`](docs/references.md)
lists projects we looked at and what may be borrowed from each.

## Questions

Ask in [Discussions](https://github.com/zoltanf/extrudo/discussions) (Q&A for
questions, Ideas for suggestions, Show and tell for what you made), or open an
issue for a bug or a concrete request.
Security problems are different: see [`SECURITY.md`](SECURITY.md).
