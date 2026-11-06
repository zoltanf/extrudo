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

/** Every `## ` section of the CHANGELOG: its heading's text and its bullets, without "2026-11-06 · ". */
export function changelogSections(markdown: string): { title: string; changes: string[] }[] {
  const lines = markdown.split(/\r?\n/);
  const starts = lines.flatMap((l, i) => (l.startsWith('## ') ? [i] : []));
  return starts.map((start, n) => ({
    title: (lines[start] ?? '').slice(3).trim(),
    changes: bullets(lines.slice(start + 1, starts[n + 1])).map((b) =>
      b.replace(/^\d{4}-\d{2}-\d{2} · /, ''),
    ),
  }));
}

/** The version a heading names (`v0.9.0 (2026-10-26)` → `0.9.0`), if any. */
export const headingVersion = (title: string) => /^v(\d+\.\d+\.\d+)\b/.exec(title)?.[1];

/** The bullets under `## vX.Y.Z`. */
export function changelogSection(markdown: string, version: string): string[] {
  return (
    changelogSections(markdown).find((s) => headingVersion(s.title) === version)?.changes ?? []
  );
}

/** An earlier release in What's new's list (ADR-0133's amendment). */
export interface ReleaseHistoryEntry {
  /** The CHANGELOG heading without `## `: `v0.9.0 (2026-10-26)`. */
  title: string;
  /** Its highlights file's bullets, where there is one. */
  highlights: string[];
  changes: string[];
}

/** Every CHANGELOG section before `version`, newest first, with highlights where they exist. */
export function releaseHistory(
  version: string,
  read: (path: string) => string | undefined = readOrUndefined,
  root = ROOT,
): ReleaseHistoryEntry[] {
  return changelogSections(read(changelogPath(root)) ?? '')
    .filter((s) => s.title !== 'Unreleased' && headingVersion(s.title) !== version)
    .map((s) => {
      const v = headingVersion(s.title);
      const highlights = v === undefined ? undefined : read(highlightsPath(v, root));
      return { ...s, highlights: highlights ? bullets(highlights.split(/\r?\n/)) : [] };
    });
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

const NOTES = 'virtual:release-notes';
const HISTORY = 'virtual:release-history';

/**
 * Serves `virtual:release-notes` (this version) and `virtual:release-history`
 * (every earlier CHANGELOG section, a bigger chunk loaded only when asked for)
 * for the package version `version` (its X.Y.Z).
 */
export function releaseNotesPlugin(version: string): Plugin {
  const base = version.split('+')[0] ?? version;
  return {
    name: 'extrudo-release-notes',
    resolveId: (id) => (id === NOTES || id === HISTORY ? `\0${id}` : undefined),
    load(id) {
      if (id !== `\0${NOTES}` && id !== `\0${HISTORY}`) return undefined;
      // Rebuilt in dev when the CHANGELOG or a highlights file changes.
      this.addWatchFile(changelogPath());
      this.addWatchFile(highlightsPath(base));
      const data = id === `\0${NOTES}` ? releaseNotes(base) : releaseHistory(base);
      return `export default ${JSON.stringify(data)};`;
    },
  };
}
