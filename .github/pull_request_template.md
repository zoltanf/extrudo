## What and why

<!-- One or two sentences. Link the issue ("Fixes #123"). -->

**Roadmap task:** <!-- P3-04, or "none" for a fix or a docs change -->
**ADR:** <!-- docs/adr/00NN-... for a significant decision, or "none needed" -->

## Checklist

- [ ] `pnpm check` passes (typecheck, Biome, package boundaries, unit tests).
- [ ] Tests cover the change (unit tests; an end-to-end spec when a UI flow changed).
- [ ] `pnpm e2e` (or the specs it touches) passes; CI runs the whole suite.
- [ ] A document or schema change updates `docs/file-format.md`.
- [ ] Roadmap ticked and a line added to `docs/CHANGELOG.md` for a roadmap task.
- [ ] The hard rules in `CONTRIBUTING.md` hold (commands for every change, kernel only in the worker, topological names for references, expression inputs for numbers).
- [ ] No secrets, personal data or private network details, and nothing copied from another product's code, icons, text or branding.
- [ ] Third-party code or assets I added are GPL-3.0-or-later compatible and listed in `NOTICE`.

## Screenshots

<!-- For anything visible: before and after, dark and light theme. If a screenshot baseline changed, say which, and that you regenerated it in the Playwright image (or took it from CI's artifact). Delete this section when nothing changed on screen. -->

## Notes for the reviewer

<!-- Anything you are unsure about, rejected approaches, follow-ups. -->
