/**
 * `writeAtomic` (P6-01, ADR-0075 §2): the atomic writer shared by the project
 * index and the plugin index. Its flush goes through the writable handle it
 * wrote with — an fsync through a read-only handle fails with EPERM on
 * Windows (FlushFileBuffers needs write access), which broke every index
 * write of v0.7.0 there.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeAtomic } from './fs-index';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'extrudo-fs-index-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('writeAtomic', () => {
  it('writes the text to the path and leaves no temp file behind', async () => {
    const dir = await tempDir();
    const path = join(dir, 'index.json');

    await writeAtomic(path, '{"projects":[]}\n');

    expect(await readFile(path, 'utf8')).toBe('{"projects":[]}\n');
    expect(await readdir(dir)).toEqual(['index.json']);
  });

  it('replaces the content of an existing file', async () => {
    const dir = await tempDir();
    const path = join(dir, 'index.json');
    await writeAtomic(path, 'old\n');

    await writeAtomic(path, 'new\n');

    expect(await readFile(path, 'utf8')).toBe('new\n');
    expect(await readdir(dir)).toEqual(['index.json']);
  });

  it('opens the temp file writable, not read-only', async () => {
    const { open } = await import('node:fs/promises');
    const dir = await tempDir();
    const path = join(dir, 'index.json');

    await writeAtomic(path, '{"projects":[]}\n');

    const opens = vi.mocked(open).mock.calls.filter(([file]) => String(file).endsWith('.tmp'));
    expect(opens.length).toBeGreaterThan(0);
    for (const call of opens) {
      expect(call[1]).toBe('w');
    }
  });

  it('removes the temp file when the write does not reach the rename', async () => {
    const dir = await tempDir();
    const path = join(dir, 'index.json');
    await writeAtomic(path, 'old\n');

    await expect(
      writeAtomic(path, 'new\n', () => {
        throw new Error('power loss');
      }),
    ).rejects.toThrow('power loss');

    expect(await readFile(path, 'utf8')).toBe('old\n');
    expect(await readdir(dir)).toEqual(['index.json']);
  });
});
