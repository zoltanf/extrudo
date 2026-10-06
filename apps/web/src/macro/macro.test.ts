import { Design } from '@extrudo/api';
import { createDocumentStore, type DocumentStore, type FeatureId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  createMacroStore,
  designCode,
  endedByUndo,
  keepScript,
  macroCode,
  recordedCount,
  replaceWithScript,
  scriptFileName,
} from './macro';

/** A plate: Sketch1 and Extrude1, as the app would have them after drawing and extruding. */
function plate(): { store: DocumentStore; ids: FeatureId[] } {
  const d = Design.create({ name: 'Plate' });
  d.parameter('thickness', '5 mm');
  const sketch = d.sketch(d.origin.xy, (k) => {
    k.rectangle([0, 0], [40, 20]);
  });
  d.extrude({ profiles: sketch.profileAt([10, 10]), distance: 'thickness' });
  const doc = d.toJSON();
  return { store: createDocumentStore(doc), ids: doc.features.map((f) => f.id) };
}

describe('macro store', () => {
  it('starts, counts the features made since, and stops', () => {
    const { store } = plate();
    const macro = createMacroStore();
    expect(recordedCount(macro.getState().recording, store.getState().doc)).toBe(0);
    macro.getState().start(1, 1);
    expect(recordedCount(macro.getState().recording, store.getState().doc)).toBe(1);
    expect(macro.getState().stop()).toEqual({ from: 1, base: 1 });
    expect(macro.getState().recording).toBeUndefined();
    expect(macro.getState().stop()).toBeUndefined();
  });

  it('ends when an undo takes the document below where it started', () => {
    const { store } = plate();
    const { doc } = store.getState();
    expect(endedByUndo({ from: 2, base: 2 }, doc)).toBe(false);
    expect(endedByUndo({ from: 3, base: 3 }, doc)).toBe(true);
    expect(endedByUndo(undefined, doc)).toBe(false);
  });
});

describe('macro code', () => {
  it('writes the recorded run, and nothing for an empty one', async () => {
    const { store, ids } = plate();
    const { doc } = store.getState();
    const run = await macroCode(doc, { from: 0, base: 0 });
    expect(run.ids).toEqual(ids);
    expect(run.code).toContain('design.sketch(');
    expect(run.code).toContain('design.extrude(');
    expect(run.code).not.toContain('design.parameter(');
    expect((await macroCode(doc, { from: 2, base: 2 })).ids).toEqual([]);
    expect(await designCode(doc)).toContain('design.parameter(');
  });

  it('writes the run at the marker when the timeline was rolled back to record', async () => {
    const { store, ids } = plate();
    const { doc } = store.getState();
    // Recorded at index 1 of 2, one feature made since: the run is the feature at index 1.
    const run = await macroCode(doc, { from: 1, base: 1 });
    expect(run.ids).toEqual([ids[1]]);
    const grown = await macroCode(doc, { from: 0, base: 1 });
    expect(grown.ids).toEqual([ids[0]]);
  });

  it('names the script file after the design', () => {
    expect(scriptFileName('Wall bracket')).toBe('Wall bracket.ts');
    expect(scriptFileName('a/b:c')).toBe('a-b-c.ts');
    expect(scriptFileName('  ')).toBe('design.ts');
  });
});

describe('Replace and Keep both', () => {
  it('replaces the run with one Script in one undo step', async () => {
    const { store, ids } = plate();
    const { code } = await macroCode(store.getState().doc, { from: 0, base: 0 });
    const result = replaceWithScript(store, { recorded: ids, code });
    expect(result.ok).toBe(true);
    const { doc } = store.getState();
    expect(doc.features.map((f) => [f.name, f.type])).toEqual([['Script1', 'script']]);
    expect(doc.features[0]?.inputs.code).toEqual({ kind: 'code', value: code });
    store.getState().undo();
    expect(store.getState().doc.features.map((f) => f.id)).toEqual(ids);
    expect(store.getState().canUndo).toBe(false);
  });

  it('is refused, with nothing changed, while a feature outside the run uses it', () => {
    const { store, ids } = plate();
    const before = store.getState().doc;
    const result = replaceWithScript(store, { recorded: [ids[0] as FeatureId], code: '// x' });
    expect(result).toEqual({
      ok: false,
      message: 'Extrude1 still uses Sketch1: keep both, or move it.',
    });
    expect(store.getState().doc).toEqual(before);
    expect(store.getState()).toMatchObject({ canUndo: false, transactionDepth: 0 });
  });

  it('says so when nothing was recorded', () => {
    const { store } = plate();
    expect(replaceWithScript(store, { recorded: [], code: '' })).toEqual({
      ok: false,
      message: 'Nothing was recorded.',
    });
  });

  it('keeps both: the Script is added last and suppressed', () => {
    const { store, ids } = plate();
    const result = keepScript(store, { code: 'design.box({});' });
    expect(result).toEqual({
      ok: true,
      message: 'Added Script1, suppressed: unsuppress it to run the macro.',
    });
    const { doc } = store.getState();
    expect(doc.features.map((f) => f.id).slice(0, 2)).toEqual(ids);
    expect(doc.features[2]).toMatchObject({ type: 'script', name: 'Script1', suppressed: true });
    expect(doc.timelineMarker).toBe(3);
  });
});
