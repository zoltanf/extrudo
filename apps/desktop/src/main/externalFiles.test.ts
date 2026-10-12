import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageError } from '@extrudo/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExternalFiles, createExternalPaths, MAX_EXTERNAL_PATHS } from './externalFiles';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'extrudo-external-'));
  file = join(dir, 'Bracket.extrudo');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('external files (P6-01 slice 2, finding 3)', () => {
  it('reads, writes and stats a path main issued', async () => {
    const paths = createExternalPaths();
    const files = createExternalFiles(paths);
    paths.issue(file);
    expect(paths.issued(file)).toBe(true);

    const written = await files.write(file, new Uint8Array([1, 2, 3]));
    expect(written.modified).toBeGreaterThan(0);
    expect((await files.stat(file))?.modified).toBe(written.modified);
    const read = await files.read(file);
    expect([...read.bytes]).toEqual([1, 2, 3]);
    expect(read.modified).toBe(written.modified);
  });

  it('refuses a path main never handed the renderer', async () => {
    const files = createExternalFiles(createExternalPaths());
    const refused = new StorageError(file, 'Extrudo was not asked to open that file.');
    await expect(files.write(file, new Uint8Array([1]))).rejects.toThrow(
      'Extrudo was not asked to open that file.',
    );
    await expect(files.write(file, new Uint8Array([1]))).rejects.toBeInstanceOf(StorageError);
    await expect(files.stat(file)).rejects.toThrow(refused.message);
    await expect(files.read(file)).rejects.toBeInstanceOf(StorageError);
  });

  it('answers undefined for an issued path that is gone', async () => {
    const paths = createExternalPaths();
    const files = createExternalFiles(paths);
    paths.issue(file);
    expect(await files.stat(file)).toBeUndefined();
    // Another path in the set is unaffected.
    const other = join(dir, 'Other.extrudo');
    writeFileSync(other, 'x');
    paths.issue(other);
    expect((await files.stat(other))?.modified).toBeGreaterThan(0);
  });
});

describe('issued paths kept across restarts (2026-10-12)', () => {
  it('a later session may still write back a path an earlier one issued', async () => {
    const kept = join(dir, 'external-paths.json');
    createExternalPaths(kept).issue(file);
    // A restart: a fresh set over the same file.
    const files = createExternalFiles(createExternalPaths(kept));
    expect((await files.write(file, new Uint8Array([4]))).modified).toBeGreaterThan(0);
    // Without the file, a restart forgets it, as before.
    await expect(
      createExternalFiles(createExternalPaths()).write(file, new Uint8Array([4])),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it('keeps the newest paths up to the limit', () => {
    const kept = join(dir, 'external-paths.json');
    const paths = createExternalPaths(kept);
    paths.issue('/first.extrudo');
    for (let n = 0; n < MAX_EXTERNAL_PATHS; n++) paths.issue(`/p${n}.extrudo`);
    const later = createExternalPaths(kept);
    expect(later.issued('/first.extrudo')).toBe(false);
    expect(later.issued('/p0.extrudo')).toBe(true);
    expect(later.issued(`/p${MAX_EXTERNAL_PATHS - 1}.extrudo`)).toBe(true);
  });

  it('starts empty on a damaged file, and a non-string entry is never issued', () => {
    const kept = join(dir, 'external-paths.json');
    writeFileSync(kept, '{ not json');
    expect(createExternalPaths(kept).issued(file)).toBe(false);
    writeFileSync(kept, JSON.stringify({ paths: [file, 42, null] }));
    const paths = createExternalPaths(kept);
    expect(paths.issued(file)).toBe(true);
    expect(paths.issued('42')).toBe(false);
  });
});
