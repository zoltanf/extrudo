import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * The release notes the app shows after an update (ADR-0133): the release's
 * hand-written highlights (`docs/release-highlights/X.Y.Z.md`) and its
 * CHANGELOG section (`## vX.Y.Z (date)`), read at build time into the virtual
 * module `virtual:release-notes`, which the app imports lazily. A version
 * without a highlights file has no notes (`null`): the app then says nothing.
 */
export interface ReleaseNotes {
  version: string;
  /** The highlights' bullets, Markdown inline (`**bold**`, `` `code` ``). */
  highlights: string[];
  /** The CHANGELOG section's bullets, without their date prefix. */
  changes: string[];
}

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const highlightsPath = (version: string, root = ROOT) =>
  `${root}docs/release-highlights/${version}.md`;
export const changelogPath = (root = ROOT) => `${root}docs/CHANGELOG.md`;

/** A Markdown list's items; an indented line continues the item above it. */
export function bullets(lines: readonly string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    if (/^[-*] /.test(line)) items.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && items.length > 0)
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
  }
  return items;
}

/** The bullets under `## vX.Y.Z`, up to the next `## ` heading, without "2026-11-06 · ". */
export function changelogSection(markdown: string, version: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `## v${version}` || l.startsWith(`## v${version} `));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return bullets(lines.slice(start + 1, end < 0 ? undefined : end)).map((b) =>
    b.replace(/^\d{4}-\d{2}-\d{2} · /, ''),
  );
}

/** The notes for `version` (X.Y.Z), or `null` without a highlights file. */
export function releaseNotes(
  version: string,
  read: (path: string) => string | undefined = readOrUndefined,
  root = ROOT,
): ReleaseNotes | null {
  const highlights = read(highlightsPath(version, root));
  if (highlights === undefined) return null;
  return {
    version,
    highlights: bullets(highlights.split(/\r?\n/)),
    changes: changelogSection(read(changelogPath(root)) ?? '', version),
  };
}

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

const ID = 'virtual:release-notes';
const RESOLVED = `\0${ID}`;

/** Serves `virtual:release-notes` for the package version `version` (its X.Y.Z). */
export function releaseNotesPlugin(version: string): Plugin {
  const base = version.split('+')[0] ?? version;
  return {
    name: 'extrudo-release-notes',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return undefined;
      // Rebuilt in dev when either file changes.
      this.addWatchFile(highlightsPath(base));
      this.addWatchFile(changelogPath());
      return `export default ${JSON.stringify(releaseNotes(base))};`;
    },
  };
}
