/**
 * S12b (ADR-0144): an array onto a mesh measures the mesh once, not once a copy, and the stored
 * shape an array's copies are checked against is decoded once.
 */
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { importFcstd } from './import';
import { nodeImportKernel } from './node-kernel-test-support';
import { linkObject, placementListEntry, structureFile } from './structure-parts';

const calls = vi.hoisted(() => ({ facts: 0, texts: 0 }));
vi.mock('./mesh-read', async (original) => {
  const m = await original<typeof import('./mesh-read')>();
  return {
    ...m,
    meshFacts: (...a: Parameters<typeof m.meshFacts>) => {
      calls.facts++;
      return m.meshFacts(...a);
    },
  };
});
vi.mock('./bodies', async (original) => {
  const m = await original<typeof import('./bodies')>();
  return {
    ...m,
    storedText: (...a: Parameters<typeof m.storedText>) => {
      calls.texts++;
      return m.storedText(...a);
    },
  };
});

let solver: SketchSolver;
beforeAll(async () => {
  solver = new SketchSolver(await loadPlanegcs());
});
const IDENTITY = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const three = placementListEntry([
  [0, 200, 0, 0, 0, 0, 1],
  [50, 200, 0, 0, 0, 0, 1],
  [100, 200, 0, 0, 0, 0, 1],
]);

describe('measured once, whatever the copies', () => {
  it('an array of three onto a mesh: the mesh measured once to import it, once to place the copies', async () => {
    const file = structureFile('meshes', {
      extra: [linkObject('Arr', 'Mesh', { count: 3, placement: IDENTITY })],
      entries: { 'Arr.PlacementList': three },
    });
    calls.facts = 0;
    const r = await importFcstd(file, 'x', { kernel: nodeImportKernel(), solver });
    expect(r.report.links[0]).toMatchObject({ outcome: 'copy' });
    // Three meshes imported (three), the cube's copies placed from one more.
    expect(calls.facts).toBe(4);
  });

  it('an array of three onto a box: its stored shape decoded once for the three checks', async () => {
    const file = structureFile('link_chain', {
      extra: [linkObject('Arr', 'Box', { count: 3, placement: IDENTITY })],
      entries: { 'Arr.PlacementList': three },
    });
    calls.texts = 0;
    const r = await importFcstd(file, 'x', { kernel: nodeImportKernel(), solver });
    expect(r.report.links.map((l) => l.outcome)).toEqual(['copy', 'copy', 'copy']);
    // Five copies (two links and the array's three) checked against the box's stored shape:
    // decoded once for them all, and once by the box's own tree check.
    expect(calls.texts).toBe(2);
  });
});
