import { createDocument } from '@extrudo/core';
import { memoryProjectStore, writeArchive } from '@extrudo/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { takeModelImport } from '../features/import';
import type { Platform } from '../platform';
import { importAnyFile, importF3dFile, MAX_F3D_BYTES, openExternalFile } from './actions';

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

describe('importF3dFile (M1)', () => {
  it('refuses a file over 100 MB before reading it', async () => {
    const projects = memoryProjectStore();
    let read = false;
    const file = {
      name: 'huge.f3d',
      size: MAX_F3D_BYTES + 1,
      arrayBuffer: () => {
        read = true;
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as File;
    await expect(importF3dFile(fakePlatform(projects), file)).rejects.toThrow(
      /too large to import/,
    );
    expect(read).toBe(false);
  });
});

describe("the home screen's Import… (ADR-0083 §4)", () => {
  const platformPicking = (projects: ReturnType<typeof memoryProjectStore>, file: File) =>
    ({
      projects,
      files: { pick: async () => file },
      storage: { requestPersistence: async () => true },
    }) as unknown as Platform;

  it('makes a new design for a model file and asks it to open the Import dialog', async () => {
    const projects = memoryProjectStore();
    const file = new File([new Uint8Array([1])], 'Bracket.stl');
    const summary = await importAnyFile(platformPicking(projects, file));
    expect(summary).toBeDefined();
    const id = summary?.id ?? '';
    expect((await projects.load(id as never)).name).toBe('Bracket');
    expect(takeModelImport(id)).toBe(file);
    expect(takeModelImport(id)).toBeUndefined();
  });

  it('imports an .extrudo file as itself, with no Import dialog', async () => {
    const projects = memoryProjectStore();
    const bytes = writeArchive(createDocument({ name: 'Saved' }));
    const file = new File([bytes as Uint8Array<ArrayBuffer>], 'Saved.extrudo');
    const summary = await importAnyFile(platformPicking(projects, file));
    const id = summary?.id ?? '';
    expect((await projects.load(id as never)).name).toBe('Saved');
    expect(takeModelImport(id)).toBeUndefined();
  });
});
