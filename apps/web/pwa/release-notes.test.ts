import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { bullets, changelogPath, changelogSection, releaseNotes } from './release-notes';

const CHANGELOG = `# Changelog

## Unreleased

- 2026-11-07 · **Next**: not yet.

## v0.10.0 (2026-11-06)

- 2026-11-06 · **One**: first.
- 2026-11-05 · **Two**: second,
  continued.

## v0.9.0 (2026-10-26)

- 2026-10-25 · **Old**: older.
`;

describe('release notes (ADR-0133)', () => {
  it('reads a list, joining indented lines to their item', () => {
    expect(bullets(['- a', '  b', '', '* c', 'text'])).toEqual(['a b', 'c']);
  });

  it("takes one version's changelog bullets without their date", () => {
    expect(changelogSection(CHANGELOG, '0.10.0')).toEqual([
      '**One**: first.',
      '**Two**: second, continued.',
    ]);
    expect(changelogSection(CHANGELOG, '0.9.0')).toEqual(['**Old**: older.']);
    expect(changelogSection(CHANGELOG, '0.1.0')).toEqual([]);
  });

  it('has no notes without a highlights file', () => {
    expect(releaseNotes('0.10.0', () => undefined, '/r/')).toBeNull();
  });

  it('joins the highlights file and the changelog section', () => {
    const files: Record<string, string> = {
      '/r/docs/release-highlights/0.10.0.md': '- **Big**: news.\n',
      '/r/docs/CHANGELOG.md': CHANGELOG,
    };
    expect(releaseNotes('0.10.0', (p) => files[p], '/r/')).toEqual({
      version: '0.10.0',
      highlights: ['**Big**: news.'],
      changes: ['**One**: first.', '**Two**: second, continued.'],
    });
  });

  it("the package version's section exists in the real CHANGELOG", () => {
    // Between releases the package keeps the last release's version, whose section is there.
    const real = readFileSync(changelogPath(), 'utf8');
    expect(changelogSection(real, pkg.version).length).toBeGreaterThan(0);
  });
});
