import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../viewport/store';
import { isExcluded, NOT_IN_SETTINGS, SECTIONS, sectionOf, visibleSections } from './inventory';

const WEB = join(__dirname, '..');
const DESKTOP = join(__dirname, '..', '..', '..', 'desktop', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every preference key the source reads or writes. */
function readKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of sources(WEB)) {
    if (file.includes(`${join(WEB, 'debug')}`)) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(
      /(?:const|let)\s+\w*(?:KEY|PREFERENCE)\w*\s*=\s*'([a-zA-Z][\w.]*)'/g,
    )) {
      keys.add(m[1] as string);
    }
    for (const m of text.matchAll(/preferences\.(?:get|set)(?:<[^(]*>)?\(\s*'([a-zA-Z][\w.]*)'/g)) {
      keys.add(m[1] as string);
    }
    for (const m of text.matchAll(/`([a-z]+)\.\$\{/g)) keys.add(`${m[1]}.*`);
  }
  for (const file of sources(DESKTOP)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/preferences\.read\(\)\['([\w.]+)'\]/g)) {
      keys.add(m[1] as string);
    }
  }
  // `viewport` is one object of display settings: its fields are the keys.
  if (keys.delete('viewport')) {
    for (const field of Object.keys(DEFAULT_SETTINGS)) keys.add(`viewport.${field}`);
  }
  return keys;
}

describe('the settings inventory', () => {
  it('places every preference key in a section or the exclusion list', () => {
    const keys = [...readKeys()].sort();
    // The scan sees what it should: a few keys it must find.
    expect(keys).toEqual(
      expect.arrayContaining(['theme', 'print.material', 'export.model', 'slicers.paths']),
    );
    const unplaced = keys.filter((k) => !sectionOf(k) && !isExcluded(k));
    expect(unplaced).toEqual([]);
  });

  it('lists a key once, and only keys that exist', () => {
    const known = readKeys();
    const all = [...SECTIONS.flatMap((s) => s.keys), ...NOT_IN_SETTINGS.map((e) => e.key)];
    expect(new Set(all).size).toBe(all.length);
    // The dialog's own key is written by the dialog, which the scan sees too.
    expect(all.filter((k) => !known.has(k))).toEqual([]);
    for (const e of NOT_IN_SETTINGS) expect(e.reason.length).toBeGreaterThan(10);
  });

  it('shows the desktop section only on the desktop', () => {
    expect(visibleSections(false).map((s) => s.id)).not.toContain('desktop');
    expect(visibleSections(true).map((s) => s.id)).toContain('desktop');
  });
});
