import { createDocument } from '@extrudo/core';
import { memoryProjectStore, writeArchive } from '@extrudo/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Platform } from '../platform';
import { openExternalFile } from './actions';

const fakePlatform = (projects: ReturnType<typeof memoryProjectStore>): Platform =>
  ({ projects }) as unknown as Platform;

const openedFile = (path: string, doc = createDocument({ name: 'From disk' })) => ({
  path,
  name: path.split('/').pop() ?? path,
  bytes: writeArchive(doc),
  modified: 123,
});

describe('openExternalFile (P6-01 slice 2, finding 3)', () => {
  const globals = globalThis as { window?: { location: { hash: string } } };
  beforeEach(() => {
    globals.window = { location: { hash: '' } };
  });
  afterEach(() => {
    delete globals.window;
  });

  it('imports the file, links it external and navigates', async () => {
    const projects = memoryProjectStore();
    const summary = await openExternalFile(fakePlatform(projects), openedFile('/models/A.extrudo'));
    const stored = await projects.get(summary.id);
    expect(stored?.linked).toEqual({ file: '/models/A.extrudo', modified: 123, external: true });
    expect((await projects.list()).map((p) => p.id)).toEqual([summary.id]);
    expect(globals.window?.location.hash).toBe(`#/p/${encodeURIComponent(summary.id)}`);
  });

  it('a second open of the same path reuses the existing project (no copy)', async () => {
    const projects = memoryProjectStore();
    const platform = fakePlatform(projects);
    const first = await openExternalFile(platform, openedFile('/models/A.extrudo'));
    const second = await openExternalFile(platform, openedFile('/models/A.extrudo'));
    expect(second.id).toBe(first.id);
    expect(await projects.list()).toHaveLength(1);
  });

  it('a different path still imports a new project', async () => {
    const projects = memoryProjectStore();
    const platform = fakePlatform(projects);
    await openExternalFile(platform, openedFile('/models/A.extrudo'));
    const other = await openExternalFile(platform, openedFile('/models/B.extrudo'));
    expect(await projects.list()).toHaveLength(2);
    const stored = await projects.get(other.id);
    expect(stored?.linked?.external).toBe(true);
    expect(stored?.linked?.file).toBe('/models/B.extrudo');
  });
});
