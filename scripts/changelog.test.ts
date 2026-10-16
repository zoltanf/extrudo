// The changelog scripts run against a temp copy of a mini repository
// (ADR-0089): both read the repo root from process.cwd(), so each case makes a
// temp dir, writes docs/CHANGELOG.md and the fragments, and runs the script
// with cwd set to the copy. `--base` needs a real git history, so it is
// checked once by hand against origin/main instead.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const COLLECT = new URL('changelog-collect.mjs', import.meta.url).pathname;
const CHECK = new URL('check-changelog.mjs', import.meta.url).pathname;

const EXISTING_CHANGELOG = `# Changelog

One line per completed roadmap task, newest first. Dates are absolute.

## Unreleased

- 2026-10-10 · **Existing line**: already folded in.

## v0.7.0 (2026-10-15)

- 2026-10-15 · **Old line**: released.
`;

const README = 'The fragments folder.\n';
const FRAGMENT_16 = '- 2026-10-16 · **Newest**: the newest change.\n';
const FRAGMENT_14 = '- 2026-10-14 · **Older**: an older change.\n';

const dirs: string[] = [];
function makeRepo(changelog: string, fragments: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'extrudo-changelog-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'docs', 'changelog.d'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'CHANGELOG.md'), changelog);
  writeFileSync(join(dir, 'docs', 'changelog.d', 'README.md'), README);
  for (const [name, content] of Object.entries(fragments)) {
    writeFileSync(join(dir, 'docs', 'changelog.d', name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs a script in a repo copy; a nonzero exit comes back as status. */
function run(
  script: string,
  dir: string,
  args: string[] = [],
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd: dir,
      encoding: 'utf8',
      // Without an explicit stdio the child's stderr prints on the test run.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function unreleased(changelog: string): string[] {
  const lines = changelog.split('\n');
  const start = lines.indexOf('## Unreleased');
  expect(start).toBeGreaterThanOrEqual(0);
  const section: string[] = [];
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.startsWith('## ')) break;
    if (line !== '') section.push(line);
  }
  return section;
}

describe('changelog-collect', () => {
  it('folds the fragments above the existing Unreleased lines, newest first', () => {
    const dir = makeRepo(EXISTING_CHANGELOG, {
      '2026-10-16-newest.md': FRAGMENT_16,
      '2026-10-14-older.md': FRAGMENT_14,
    });
    const result = run(COLLECT, dir);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('Folded 2 fragments into docs/CHANGELOG.md\n');
    expect(unreleased(readFileSync(join(dir, 'docs', 'CHANGELOG.md'), 'utf8'))).toEqual([
      '- 2026-10-16 · **Newest**: the newest change.',
      '- 2026-10-14 · **Older**: an older change.',
      '- 2026-10-10 · **Existing line**: already folded in.',
    ]);
    expect(existsSync(join(dir, 'docs', 'changelog.d', '2026-10-16-newest.md'))).toBe(false);
    expect(existsSync(join(dir, 'docs', 'changelog.d', '2026-10-14-older.md'))).toBe(false);
    expect(readFileSync(join(dir, 'docs', 'changelog.d', 'README.md'), 'utf8')).toBe(README);
  });

  it('does nothing without fragments', () => {
    const dir = makeRepo(EXISTING_CHANGELOG);
    const before = readFileSync(join(dir, 'docs', 'CHANGELOG.md'));
    const result = run(COLLECT, dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('No fragments.\n');
    expect(readFileSync(join(dir, 'docs', 'CHANGELOG.md')).equals(before)).toBe(true);
  });

  it('refuses a fragment with two lines, changes nothing', () => {
    const dir = makeRepo(EXISTING_CHANGELOG, {
      '2026-10-16-two-lines.md': `${FRAGMENT_16}\nA second paragraph.\n`,
    });
    const before = readFileSync(join(dir, 'docs', 'CHANGELOG.md'));
    const result = run(COLLECT, dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/changelog.d/2026-10-16-two-lines.md');
    expect(readFileSync(join(dir, 'docs', 'CHANGELOG.md')).equals(before)).toBe(true);
    expect(existsSync(join(dir, 'docs', 'changelog.d', '2026-10-16-two-lines.md'))).toBe(true);
  });

  it('creates the Unreleased section above the first version heading', () => {
    const changelog = EXISTING_CHANGELOG.replace(
      '## Unreleased\n\n- 2026-10-10 · **Existing line**: already folded in.\n\n',
      '',
    );
    const dir = makeRepo(changelog, { '2026-10-16-newest.md': FRAGMENT_16 });
    const result = run(COLLECT, dir);
    expect(result.status).toBe(0);
    const lines = readFileSync(join(dir, 'docs', 'CHANGELOG.md'), 'utf8').split('\n');
    const headingAt = lines.indexOf('## Unreleased');
    expect(lines[headingAt + 2]).toBe(FRAGMENT_16.trimEnd());
    expect(lines[headingAt + 4]).toBe('## v0.7.0 (2026-10-15)');
    expect(unreleased(readFileSync(join(dir, 'docs', 'CHANGELOG.md'), 'utf8'))).toEqual([
      FRAGMENT_16.trimEnd(),
    ]);
  });
});

describe('check-changelog', () => {
  it('accepts a clean layout', () => {
    const dir = makeRepo(EXISTING_CHANGELOG, { '2026-10-16-newest.md': FRAGMENT_16 });
    const result = run(CHECK, dir);
    expect(result.status).toBe(0);
  });

  it('refuses a fragment whose name breaks the rule', () => {
    const dir = makeRepo(EXISTING_CHANGELOG, { 'notes.md': FRAGMENT_16 });
    const result = run(CHECK, dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/changelog.d/notes.md');
  });

  it('refuses a fragment whose line breaks the rule', () => {
    const dir = makeRepo(EXISTING_CHANGELOG, { '2026-10-16-bad.md': 'A paragraph, not a line.\n' });
    const result = run(CHECK, dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/changelog.d/2026-10-16-bad.md');
  });

  it('refuses a conflict marker in docs/CHANGELOG.md', () => {
    const conflicted = EXISTING_CHANGELOG.replace(
      '- 2026-10-10 · **Existing line**: already folded in.',
      '<<<<<<< HEAD\n- 2026-10-10 · **Existing line**: already folded in.\n=======\n>>>>>>> other\n',
    );
    const dir = makeRepo(conflicted, { '2026-10-16-newest.md': FRAGMENT_16 });
    const result = run(CHECK, dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/CHANGELOG.md:7');
  });

  it('refuses a fragment whose line is already in docs/CHANGELOG.md', () => {
    const dir = makeRepo(EXISTING_CHANGELOG, {
      '2026-10-10-existing.md': '- 2026-10-10 · **Existing line**: already folded in.\n',
    });
    const result = run(CHECK, dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already in docs/CHANGELOG.md');
  });
});
