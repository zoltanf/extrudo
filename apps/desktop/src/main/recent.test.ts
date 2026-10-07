import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRecentFile, MAX_RECENT } from './recent';

let dir: string;
let file: string;
let paths: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'extrudo-recent-'));
  file = join(dir, 'recent.json');
  paths = [];
  for (let i = 0; i < 12; i += 1) {
    const path = join(dir, `file-${i}.extrudo`);
    writeFileSync(path, 'x');
    paths.push(path);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const at = (index: number): string => paths[index] as string;

describe('recent files (P6-01 slice 2)', () => {
  it('adds most recent first, deduplicates and caps the list', () => {
    const recent = createRecentFile(file);
    for (const path of paths) recent.add(path);
    const listed = recent.list();
    expect(listed).toHaveLength(MAX_RECENT);
    expect(listed[0]?.path).toBe(at(11));
    expect(listed[0]?.name).toBe('file-11.extrudo');

    recent.add(at(3));
    expect(recent.list()[0]?.path).toBe(at(3));
    expect(recent.list().filter((entry) => entry.path === at(3))).toHaveLength(1);
  });

  it('drops a missing file when the list is read', () => {
    const recent = createRecentFile(file);
    recent.add(at(0));
    recent.add(at(1));
    rmSync(at(0));
    expect(recent.list().map((entry) => entry.path)).toEqual([at(1)]);
    // The stored file was cleaned up too.
    expect(
      createRecentFile(file)
        .list()
        .map((entry) => entry.path),
    ).toEqual([at(1)]);
  });

  it('removes a path and clears the list, keeping them across a reopen', () => {
    const recent = createRecentFile(file);
    recent.add(at(0));
    recent.add(at(1));
    recent.remove(at(0));
    expect(recent.list().map((entry) => entry.path)).toEqual([at(1)]);
    recent.clear();
    expect(recent.list()).toEqual([]);
    expect(createRecentFile(file).list()).toEqual([]);
  });
});
