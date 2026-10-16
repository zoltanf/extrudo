#!/usr/bin/env node
// Folds the changelog fragments into docs/CHANGELOG.md and deletes them
// (ADR-0089): a change describes itself in a one-line file under
// docs/changelog.d/ instead of a line in the changelog, so open pull requests
// never conflict there. Run at release time, as `pnpm changelog`.
//
// Every fragment (docs/changelog.d/*.md except README.md) must be exactly one
// release line; the lines go above the ones already under `## Unreleased`,
// newest first. The repository root is the working directory.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One line: `- YYYY-MM-DD · **Title**: …` and nothing else (a trailing newline
// is fine; no heading, no blank lines, no second paragraph).
const LINE = /^- \d{4}-\d{2}-\d{2} · \*\*[^*]+\*\*.*\S\n?$/;
const LINE_RULE =
  'must be exactly one line "- YYYY-MM-DD · **Title**: …" (no heading, no blank lines, no second paragraph)';

const root = process.cwd();
const fragmentsDir = join(root, 'docs', 'changelog.d');
const changelogPath = join(root, 'docs', 'CHANGELOG.md');

const problems = [];
const names = [];
if (existsSync(fragmentsDir)) {
  names.push(
    ...readdirSync(fragmentsDir)
      .filter((name) => name.endsWith('.md') && name !== 'README.md')
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

const fragments = [];
for (const name of names) {
  const content = readFileSync(join(fragmentsDir, name), 'utf8');
  if (!LINE.test(content)) {
    problems.push(`docs/changelog.d/${name}: ${LINE_RULE}`);
    continue;
  }
  fragments.push({ name, line: content.replace(/\n$/, '') });
}

if (problems.length > 0) {
  console.error(`Changelog fragments are invalid, folded nothing:\n${problems.join('\n')}`);
  process.exit(1);
}

if (fragments.length === 0) {
  console.log('No fragments.');
  process.exit(0);
}

// Newest first by the date in the line; the sort is stable, so fragments with
// the same date keep their file-name order.
const dateOf = (line) => line.slice(2, 12);
fragments.sort((a, b) =>
  dateOf(b.line) < dateOf(a.line) ? -1 : dateOf(b.line) > dateOf(a.line) ? 1 : 0,
);

const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
const lines = changelog === '' ? [] : changelog.split('\n');
const entries = fragments.map((fragment) => fragment.line);
const headingAt = lines.indexOf('## Unreleased');
if (headingAt >= 0) {
  // The heading's line, then its blank line, then the lines already there: the
  // fragments go between the blank line and them.
  if (lines[headingAt + 1] === '') {
    lines.splice(headingAt + 2, 0, ...entries);
  } else {
    lines.splice(headingAt + 1, 0, '', ...entries);
  }
} else {
  // Right after a release the heading is renamed, so make the section again,
  // above the first `## v` heading (or at the end when none is there yet).
  const firstVersionAt = lines.findIndex((line) => /^## v/.test(line));
  if (firstVersionAt < 0) lines.push('## Unreleased', '', ...entries);
  else lines.splice(firstVersionAt, 0, '## Unreleased', '', ...entries, '');
}

const folded = lines.join('\n');
writeFileSync(changelogPath, folded.endsWith('\n') || folded === '' ? folded : `${folded}\n`);
for (const { name } of fragments) rmSync(join(fragmentsDir, name));
console.log(`Folded ${fragments.length} fragments into docs/CHANGELOG.md`);
