import {
  addParameter,
  applyCommand,
  createDocument,
  type DocumentId,
  type ExtrudoDocument,
  type ParameterId,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { memoryFiles } from './files';
import { memoryIndex } from './idb';
import { createProjectStore } from './project-store';
import { ProjectNotFoundError } from './types';

function setup() {
  let clock = Date.parse('2026-09-25T10:00:00.000Z');
  let ids = 0;
  const files = memoryFiles();
  const store = createProjectStore({
    index: memoryIndex(),
    files,
    appVersion: '0.1.0',
    now: () => {
      clock += 1000;
      return new Date(clock).toISOString();
    },
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` as DocumentId,
  });
  return { store, files };
}

const doc = (name: string): ExtrudoDocument =>
  applyCommand(
    createDocument({ name, now: '2026-09-01T00:00:00.000Z' }),
    addParameter({
      parameter: {
        id: crypto.randomUUID() as ParameterId,
        name: 'wall',
        expression: '2.4 mm',
        unit: 'length',
      },
    }),
  ).doc;

const png = (...bytes: number[]) => new Blob([new Uint8Array([137, 80, 78, 71, ...bytes])]);

describe('ProjectStore', () => {
  it('saves and loads a document, stamping modified and the app version', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    const summary = await store.save(d);
    expect(summary).toMatchObject({ id: d.id, name: 'Bracket', hasThumbnail: false });
    expect(summary.created).toBe('2026-09-01T00:00:00.000Z');
    expect(summary.modified).toBe('2026-09-25T10:00:01.000Z');

    const loaded = await store.load(d.id);
    expect(loaded.parameters.map((p) => p.name)).toEqual(['wall']);
    expect(loaded.meta.modified).toBe(summary.modified);
    expect(loaded.meta.appVersion).toBe('0.1.0');
    // The caller's document is not touched.
    expect(d.meta.modified).toBe('2026-09-01T00:00:00.000Z');
  });

  it('lists projects, most recently modified first, and updates on save', async () => {
    const { store } = setup();
    const a = doc('A');
    const b = doc('B');
    await store.save(a);
    await store.save(b);
    expect((await store.list()).map((s) => s.name)).toEqual(['B', 'A']);
    await store.save({ ...a, name: 'A again' });
    expect((await store.list()).map((s) => s.name)).toEqual(['A again', 'B']);
  });

  it('renames, keeping everything else', async () => {
    const { store } = setup();
    const d = doc('Old');
    await store.save(d);
    const renamed = await store.rename(d.id, '  New name ');
    expect(renamed.name).toBe('New name');
    expect((await store.load(d.id)).name).toBe('New name');
    await expect(store.rename(d.id, '   ')).rejects.toThrow('needs a name');
  });

  it('duplicates with a new ID and name, copying the thumbnail', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.setThumbnail(d.id, png(1, 2, 3));
    const copy = await store.duplicate(d.id);
    expect(copy.id).not.toBe(d.id);
    expect(copy.name).toBe('Bracket copy');
    expect(copy.hasThumbnail).toBe(true);
    const loaded = await store.load(copy.id);
    expect(loaded.id).toBe(copy.id);
    expect(loaded.parameters).toEqual(d.parameters);
    expect(new Uint8Array(await ((await store.thumbnail(copy.id)) as Blob).arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );
    expect(await store.list()).toHaveLength(2);
  });

  it('moves projects to the trash and back, and a save keeps them there', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.trash(d.id);
    expect((await store.get(d.id))?.trashed).toBeDefined();
    await store.save(d);
    expect((await store.get(d.id))?.trashed).toBeDefined();
    await store.restore(d.id);
    expect((await store.get(d.id))?.trashed).toBeUndefined();
  });

  it('purges a project and all its files', async () => {
    const { store, files } = setup();
    const keep = doc('Keep');
    const gone = doc('Gone');
    await store.save(keep);
    await store.save(gone);
    await store.setThumbnail(gone.id, png());
    await store.purge(gone.id);
    expect(files.paths()).toEqual([`projects/${keep.id}/document.json`]);
    expect(await store.list()).toHaveLength(1);
    await expect(store.load(gone.id)).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('refuses unknown projects', async () => {
    const { store } = setup();
    const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff' as DocumentId;
    await expect(store.load(id)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(store.trash(id)).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(store.setThumbnail(id, png())).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(await store.thumbnail(id)).toBeNull();
  });

  it('says so when a listed project has lost its document', async () => {
    const { store, files } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await files.remove(`projects/${d.id}/document.json`);
    await expect(store.load(d.id)).rejects.toThrow('document is missing');
  });

  it('exports and imports a project; importing it again makes a copy', async () => {
    const { store } = setup();
    const d = doc('Bracket');
    await store.save(d);
    await store.setThumbnail(d.id, png(9));
    const file = await store.exportFile(d.id);

    const other = setup().store;
    const imported = await other.importFile(file);
    expect(imported).toMatchObject({ id: d.id, name: 'Bracket', hasThumbnail: true });
    const loaded = await other.load(d.id);
    expect(loaded.parameters).toEqual(d.parameters);
    expect(loaded.features).toEqual(d.features);

    const again = await other.importFile(file);
    expect(again.id).not.toBe(d.id);
    expect(again.name).toBe('Bracket');
    expect(await other.list()).toHaveLength(2);
  });
});
