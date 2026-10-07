import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageError } from '@extrudo/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExternalFiles, createExternalPaths } from './externalFiles';

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
