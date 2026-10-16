#!/usr/bin/env node
// Lints the changelog fragments (ADR-0089). Fails, one line per problem, when:
//
// - a fragment under docs/changelog.d/ (except README.md) breaks the name rule
//   (YYYY-MM-DD-<slug>.md) or the line rule (exactly one release line);
// - docs/CHANGELOG.md carries a merge-conflict marker;
// - a fragment's line is already in docs/CHANGELOG.md (it was folded in; don't
//   re-add it).
//
// With `--base <git ref>` (CI on a pull request) it additionally fails when the
// diff against that ref touched docs/CHANGELOG.md: a pull request adds a file
// under docs/changelog.d/ instead of editing the changelog. The repository
// root is the working directory.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
// One line: `- YYYY-MM-DD · **Title**: …` and nothing else (a trailing newline
// is fine; no heading, no blank lines, no second paragraph).
const LINE = /^- \d{4}-\d{2}-\d{2} · \*\*[^*]+\*\*.*\S\n?$/;
const NAME_RULE =
  'the name must be YYYY-MM-DD-<slug>.md (the date the change was finished, a short kebab-case slug, e.g. 2026-10-16-changelog-fragments.md)';
const LINE_RULE =
  'must be exactly one line "- YYYY-MM-DD · **Title**: …" (no heading, no blank lines, no second paragraph)';

const root = process.cwd();
const fragmentsDir = join(root, 'docs', 'changelog.d');
const changelogPath = join(root, 'docs', 'CHANGELOG.md');
const problems = [];

const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';

if (existsSync(fragmentsDir)) {
  const names = readdirSync(fragmentsDir).filter(
    (name) => name.endsWith('.md') && name !== 'README.md',
  );
  for (const name of names) {
    const path = `docs/changelog.d/${name}`;
    if (!NAME.test(name)) problems.push(`${path}: ${NAME_RULE}`);
    const content = readFileSync(join(fragmentsDir, name), 'utf8');
    if (!LINE.test(content)) {
      problems.push(`${path}: ${LINE_RULE}`);
    } else if (changelog.includes(content.replace(/\n$/, ''))) {
      problems.push(
        `${path}: its line is already in docs/CHANGELOG.md (folded in by pnpm changelog; don't re-add it)`,
      );
    }
  }
}

// Git's conflict markers are seven characters at the start of a line.
const changelogLines = changelog.split('\n');
for (let i = 0; i < changelogLines.length; i++) {
  if (/^(<{7}|={7}|>{7})/.test(changelogLines[i])) {
    problems.push(
      `docs/CHANGELOG.md:${i + 1}: looks like a merge-conflict marker, resolve it first`,
    );
  }
}

const baseAt = process.argv.indexOf('--base');
if (baseAt >= 0) {
  const base = process.argv[baseAt + 1];
  if (base === undefined) {
    problems.push('--base needs a git ref (e.g. --base origin/main)');
  } else {
    try {
      const diff = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const touched = diff.split('\n').map((path) => path.trim());
      if (touched.includes('docs/CHANGELOG.md')) {
        problems.push(
          'A pull request adds a file under docs/changelog.d/ instead of editing docs/CHANGELOG.md (ADR-0089).',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(`git diff --name-only ${base}...HEAD failed: ${message.split('\n')[0]}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Changelog check failed:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('Changelog check OK.');
