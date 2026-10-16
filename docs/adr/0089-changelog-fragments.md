# ADR-0089: Changelog fragments, one file per change

- **Status:** Accepted, 2026-10-16
- **No schema or file-format change.** The document model is untouched; this is
  repository tooling.

## Context

Every change adds its line to the top of `## Unreleased` in
`docs/CHANGELOG.md`, so any two open pull requests conflict on that one file:
the last five PRs each needed one or two re-merges for it alone. The changelog
is edited by hand at the one place every PR touches, which is the worst possible
spot for a line that is really per-change data.

## Decision

### 1. A change describes itself in its own fragment file

Directory **`docs/changelog.d/`**. One file per change, named
**`YYYY-MM-DD-<slug>.md`** — the date the change was finished and a short
kebab-case slug (e.g. `2026-10-16-changelog-fragments.md`). The content is
**exactly one line**, the same line that used to go into the changelog:

```
- YYYY-MM-DD · **Title**: …
```

and it must match `^- \d{4}-\d{2}-\d{2} · \*\*[^*]+\*\*.*\S\n?$` (a trailing
newline is fine; no heading, no blank lines, no second paragraph). The folder
holds a `README.md` — kept there permanently, excluded from collection — that
says what the folder is and the rules.

### 2. `pnpm changelog` folds the fragments in at release time

`scripts/changelog-collect.mjs` (run from the repository root): reads every
`docs/changelog.d/*.md` except `README.md`, validates each against the line
regex (exit 1 naming the file and the rule, nothing written on a failure), sorts
the lines newest first by the date in the line (stable: ties keep file-name
order), inserts them directly under the `## Unreleased` heading's following
blank line — above the lines already there — and deletes the fragment files it
folded in, printing `Folded N fragments into docs/CHANGELOG.md` (or
`No fragments.` with exit 0). If `## Unreleased` is missing (right after a
release renamed it) the section is created, with a blank line, above the first
`## v` heading. No dependencies beyond `node:fs`/`node:path`.

### 3. `scripts/check-changelog.mjs` lints it, in `pnpm lint`

Fails (one line per problem) when a fragment breaks the name or line rule, when
`docs/CHANGELOG.md` contains a merge-conflict marker (`<<<<<<<`, `=======`,
`>>>>>>>` at line start), or when a fragment's line already appears verbatim in
`docs/CHANGELOG.md` (it was folded in; re-adding it is how the line gets
duplicated). With **`--base <git ref>`** it additionally fails when
`git diff --name-only <ref>...HEAD` lists `docs/CHANGELOG.md`:

> A pull request adds a file under docs/changelog.d/ instead of editing
> docs/CHANGELOG.md (ADR-0089).

Without `--base` that check is skipped, so local `pnpm lint` and pushes to main
(whose release commit does rename the heading) pass.

### 4. CI runs the `--base` check on pull requests

In the `check` job, before `pnpm check`, only for pull requests:
`node scripts/check-changelog.mjs --base "origin/${{ github.base_ref }}"`. The
job's checkout uses **`fetch-depth: 0`** so the three-dot diff has the merge
base even when `main` moved on while the branch was open; the other jobs keep
their shallow checkout. (A two-dot `git diff origin/<base> HEAD` would also work
from a shallow clone but would blame the branch for changelog lines that only
merged to main after the branch was cut — a PR open across a release would fail
wrongly.)

The scripts' behaviour is tested in `scripts/changelog.test.ts` (Vitest runs
`scripts/` as a project in the root config; the root `tsconfig.json` typechecks
it). `--base` itself needs a real git history, so it is exercised by hand, once
per job, against `origin/main`.

## Rejected

- **A `.gitattributes` `merge=union` driver for `docs/CHANGELOG.md`**: GitHub's
  mergeability check ignores merge attributes, so pull requests would still
  show as conflicting.
- **Generating the changelog from squash-commit messages at release**: commits
  straight to main get no line, and the wording quality would depend on PR
  bodies instead of the change's own fragment.
- **Appending at the bottom of `## Unreleased` instead of fragment files**: two
  pull requests would still touch the same spot and conflict.

## Consequences

- Open pull requests never conflict on the changelog: each adds its own new
  file. The `## Unreleased` section is empty between releases, except right
  before one.
- A change's line is written once, next to the code; `pnpm changelog` at
  release-time is deterministic, and the release notes step reads
  `## Unreleased` after it runs (`docs/release-checklist.md` step 2).
- A fragment that breaks the rules fails lint, not the release; a line that was
  already folded in is refused, so it cannot be duplicated by re-adding the
  file.
