# Changelog fragments

One file per completed change, so concurrent pull requests never conflict in
`docs/CHANGELOG.md` (ADR-0089). Name a fragment `YYYY-MM-DD-<slug>.md` (the date
the change was finished, a short kebab-case slug) and make its content exactly
one line, the line the release notes should carry:
`- YYYY-MM-DD · **Title**: …`. Never edit `docs/CHANGELOG.md` in a pull request;
at release time `pnpm changelog` folds every fragment into its `## Unreleased`
section and deletes the files.
