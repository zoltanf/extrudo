/**
 * The generated tool reference (ADR-0080 §2, §4).
 *
 * The staleness test: regenerating the pages in memory gives the checked-in
 * files under `docs/guide/tools/` byte for byte, and no file is left over, so a
 * new tool, key or demo reaches the docs by running `pnpm docs:generate` and
 * nothing else. The unit cases pin what the generator promises: notes survive,
 * a tool in two tabs lists both placements, a `comesWith` tool gets no page and
 * `Mod` reads as Ctrl.
 *
 * This is the one place `node:fs` is used: the app's Vitest runs in Node.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toolPages } from './toolDocs';

/** The repository root, four levels up from `apps/web/src/shell`. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const TOOLS_DIR = 'docs/guide/tools';

/** A generated page as it is on disk, or `undefined` when there is none. */
function onDisk(path: string): string | undefined {
  const file = join(ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

describe('the tool pages', () => {
  const pages = toolPages(onDisk);

  it('are what the generator writes today', () => {
    for (const [path, text] of pages) {
      expect(onDisk(path), `run pnpm docs:generate for ${path}`).toBe(text);
    }
  });

  it('leave no page behind that the generator no longer makes', () => {
    const known = new Set([...pages.keys()].map((path) => path.slice(TOOLS_DIR.length + 1)));
    for (const name of readdirSync(join(ROOT, TOOLS_DIR)).filter((n) => n.endsWith('.md'))) {
      expect(known.has(name), `run pnpm docs:generate: ${name} is extra`).toBe(true);
    }
  });

  it('make the index and one page per tool', () => {
    expect(pages.has(`${TOOLS_DIR}/index.md`)).toBe(true);
    expect(pages.size).toBeGreaterThan(90);
  });
});

describe('a tool page', () => {
  it('carries the notes between the markers over', () => {
    const existing = `---\ntitle: Extrude\n---\n\n<!-- notes -->\nKeep me.\nAnd me.\n<!-- /notes -->\n`;
    const pages = toolPages((path) => (path.endsWith('/extrude.md') ? existing : undefined));
    expect(pages.get(`${TOOLS_DIR}/extrude.md`)).toContain('Keep me.\nAnd me.');
  });

  it('has an empty notes block when there were none', () => {
    const pages = toolPages(() => undefined);
    expect(pages.get(`${TOOLS_DIR}/extrude.md`)).toContain('<!-- notes -->\n<!-- /notes -->');
  });

  it('lists every placement of a tool that lives in two tabs', () => {
    const pages = toolPages(() => undefined);
    const extrude = pages.get(`${TOOLS_DIR}/export.md`);
    expect(extrude).toContain('Home › Files (as Export Model) · 3D Print › Output');
  });

  it('makes no page for a tool that is not ready yet', () => {
    const pages = toolPages(() => undefined);
    expect(pages.has(`${TOOLS_DIR}/slicer.md`)).toBe(false);
    expect(pages.get(`${TOOLS_DIR}/index.md`)).not.toContain('slicer.md');
  });

  it('reads Mod as Ctrl', () => {
    const pages = toolPages(() => undefined);
    expect(pages.get(`${TOOLS_DIR}/saveVersion.md`)).toContain('Ctrl+S');
    expect(pages.get(`${TOOLS_DIR}/line.md`)).toContain('L');
    expect(pages.get(`${TOOLS_DIR}/sketch.md`)).toContain('None');
  });
});
