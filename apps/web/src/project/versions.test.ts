import { addParameter, createDocument, createDocumentStore, type ParameterId } from '@extrudo/core';
import { memoryProjectStore } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import {
  deleteVersions,
  olderVersions,
  openVersionCopy,
  restoreVersion,
  saveVersion,
  type VersionContext,
  versionsLabel,
} from './versions';

async function setup() {
  const doc = createDocument({ name: 'Bracket', now: '2026-09-01T00:00:00.000Z' });
  const projects = memoryProjectStore();
  await projects.save(doc);
  const store = createDocumentStore(doc);
  let flushed = 0;
  const ctx: VersionContext = {
    store,
    projects,
    autosave: {
      flush: async () => {
        flushed++;
      },
      getState: () => ({ status: 'saved', error: undefined, savedAt: undefined }),
    },
    now: () => '2026-09-29T08:00:00.000Z',
  };
  const addWall = (name: string) =>
    store.getState().dispatch(
      addParameter({
        parameter: {
          id: crypto.randomUUID() as ParameterId,
          name,
          expression: '2 mm',
          unit: 'length',
        },
      }),
    );
  const names = () => store.getState().doc.parameters.map((p) => p.name);
  return { ctx, store, projects, addWall, names, flushed: () => flushed };
}

describe('versions', () => {
  it('saves the design as it is now, after autosave has caught up', async () => {
    const { ctx, projects, addWall, flushed } = await setup();
    addWall('wall');
    const v1 = await saveVersion(ctx, 'with a wall');
    expect(flushed()).toBe(1);
    expect(v1).toMatchObject({ number: 1, description: 'with a wall', name: 'Bracket' });
    const id = ctx.store.getState().doc.id;
    expect((await projects.loadVersion(id, 1)).parameters.map((p) => p.name)).toEqual(['wall']);
    expect((await projects.load(id)).parameters).toHaveLength(1);
  });

  it('restores a version as one undo step, keeping what was there as a version first', async () => {
    const { ctx, store, projects, addWall, names } = await setup();
    const id = store.getState().doc.id;
    addWall('a');
    await saveVersion(ctx, 'one');
    addWall('b');
    addWall('c');
    expect(names()).toEqual(['a', 'b', 'c']);

    const { restored, kept } = await restoreVersion(ctx, 1);
    expect(restored.number).toBe(1);
    expect(kept).toMatchObject({ number: 2, description: 'Before restoring V1' });
    expect(names()).toEqual(['a']);
    expect(store.getState().undoLabel).toBe('Restore version');
    expect(store.getState().doc.name).toBe('Bracket');
    expect((await projects.loadVersion(id, 2)).parameters.map((p) => p.name)).toEqual([
      'a',
      'b',
      'c',
    ]);
    store.getState().undo();
    expect(names()).toEqual(['a', 'b', 'c']);
  });

  it("doesn't keep another version when the newest one holds the design already", async () => {
    const { ctx, projects, addWall, names } = await setup();
    addWall('a');
    await saveVersion(ctx, 'one');
    addWall('b');
    await saveVersion(ctx, 'two');
    const { kept } = await restoreVersion(ctx, 1);
    expect(kept).toBeUndefined();
    expect(names()).toEqual(['a']);
    expect(await projects.versions(ctx.store.getState().doc.id)).toHaveLength(2);
    await expect(restoreVersion(ctx, 9)).rejects.toThrow('no version 9');
  });

  it('opens a version as a new design and leaves this one alone', async () => {
    const { ctx, store, projects, addWall, names } = await setup();
    addWall('a');
    await saveVersion(ctx, 'one');
    addWall('b');
    const copy = await openVersionCopy(ctx, 1);
    expect(copy).not.toBe(store.getState().doc.id);
    const doc = await projects.load(copy);
    expect(doc.name).toBe('Bracket V1');
    expect(doc.parameters.map((p) => p.name)).toEqual(['a']);
    expect(doc.meta.created).toBe('2026-09-29T08:00:00.000Z');
    expect(names()).toEqual(['a', 'b']);
  });

  it('deletes versions, and names them for the confirmation (P3-13)', async () => {
    const { ctx, projects } = await setup();
    for (const note of ['a', 'b', 'c']) await saveVersion(ctx, note);
    const id = ctx.store.getState().doc.id;
    await deleteVersions(ctx, [1, 3]);
    expect((await projects.versions(id)).map((v) => v.number)).toEqual([2]);
    expect(versionsLabel([3])).toBe('V3');
    expect(versionsLabel([4, 2])).toBe('V2 and V4');
    expect(versionsLabel([3, 1, 2])).toBe('V1–V3');
    expect(versionsLabel([1, 5, 9])).toBe('3 versions');
    const list = await projects.versions(id);
    expect(olderVersions(list, 1)).toEqual([]);
    expect(olderVersions([...list, ...list], 1)).toHaveLength(1);
  });
});
