/**
 * `storedShapeToStep` (P6-25 S3, ADR-0144 decision 5): only an import kernel
 * reads B-rep text; it places the shape, writes STEP and reads it back, and
 * leaves nothing alive.
 */

import { type BodyId, type Feature, primitiveInputs } from '@extrudo/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { importRebuilder } from './import-rebuild';
import { loadOcct } from './occt/load';
import { BOX, boxBrep, cylinderBrep, LOCATED_FACE_PLACED } from './read-brep-test-support';
import { testDocument, testFeature } from './recompute/testing';
import type { KernelApi } from './service';
import { KernelService } from './service';
import { chainMatrix, placementMatrix, type ShapePlacement } from './stored-shape';

let normal: KernelService;
let importer: KernelService;

beforeAll(async () => {
  normal = new KernelService(() => loadOcct());
  importer = new KernelService(() => loadOcct(), { importKernel: true });
  await Promise.all([normal.init(), importer.init()]);
});

const turnZ = (deg: number): ShapePlacement['rotation'] => {
  const half = (deg * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};

const expectBox = (
  box: { min: number[]; max: number[] },
  [x0, y0, z0, x1, y1, z1]: number[],
  digits = 5,
) => {
  [...box.min, ...box.max].forEach((v, i) => {
    expect(v).toBeCloseTo([x0, y0, z0, x1, y1, z1][i] as number, digits);
  });
};

describe('storedShapeToStep', () => {
  it("is refused by a project's kernel", async () => {
    await expect(normal.storedShapeToStep(BOX, [])).rejects.toThrow(/only an import's own kernel/);
    expect((await normal.stats()).liveShapes).toBe(0);
  });

  it('converts a box and measures it before and after STEP', async () => {
    const result = await importer.storedShapeToStep(BOX, [], { name: 'Box', color: '#ff8000' });
    expect(result.step).toMatch(/^ISO-10303-21;/);
    expect(result.step).toContain("'Box'");
    expect(result.solids).toBe(1);
    expect(result.read.solids).toBe(1);
    expect(result.volume).toBeCloseTo(6000, 6);
    expect(result.read.volume).toBeCloseTo(6000, 6);
    expect(result.area).toBeCloseTo(2 * (200 + 300 + 600), 6);
    expectBox(result.box, [0, 0, 0, 10, 20, 30]);
    expectBox(result.read.box, [0, 0, 0, 10, 20, 30]);
    expect((await importer.stats()).liveShapes).toBe(0);
  });

  it('writes the same STEP for the same shape, so imports can share an attachment', async () => {
    const a = await importer.storedShapeToStep(BOX, []);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const b = await importer.storedShapeToStep(BOX, []);
    expect(b.step).toBe(a.step);
  });

  it('applies the placements outermost first', async () => {
    // Inner: a quarter turn about z. Outer: a move by (100, 0, 0).
    // The box (0..10, 0..20, 0..30) turned lands at (-20..0, 0..10), then moves.
    const chain: ShapePlacement[] = [
      { position: [100, 0, 0], rotation: [0, 0, 0, 1] },
      { position: [0, 0, 0], rotation: turnZ(90) },
    ];
    const result = await importer.storedShapeToStep(BOX, chain);
    expectBox(result.read.box, [80, 0, 0, 100, 10, 30]);
    expectBox(result.box, [80, 0, 0, 100, 10, 30]);
    expect(result.volume).toBeCloseTo(6000, 6);
    // The other order: the move turned with it.
    const reversed = await importer.storedShapeToStep(BOX, [...chain].reverse());
    expectBox(reversed.box, [-20, 100, 0, 0, 110, 30]);
    expect((await importer.stats()).liveShapes).toBe(0);
  });

  it('keeps the solid of a located shape and moves it', async () => {
    const plain = await importer.storedShapeToStep(LOCATED_FACE_PLACED, []);
    const moved = await importer.storedShapeToStep(LOCATED_FACE_PLACED, [
      { position: [0, 0, 50], rotation: [0, 0, 0, 1] },
    ]);
    expect(plain.solids).toBe(1);
    expect(moved.solids).toBe(1);
    expect(Math.abs(moved.volume - plain.read.volume)).toBeLessThan(1e-6 * plain.read.volume);
    expect(moved.box.min[2]).toBeCloseTo(plain.box.min[2] + 50, 5);
    expect((await importer.stats()).liveShapes).toBe(0);
  });

  it('refuses a bad text or a placement that is not finite, leaving nothing', async () => {
    await expect(importer.storedShapeToStep('not a shape', [])).rejects.toThrow();
    await expect(
      importer.storedShapeToStep(BOX, [{ position: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1] }]),
    ).rejects.toThrow(/not finite/);
    await expect(
      importer.storedShapeToStep(BOX, [{ position: [0, 0, 0], rotation: [0, 0, 0, 0] }]),
    ).rejects.toThrow(/zero rotation/);
    expect((await importer.stats()).liveShapes).toBe(0);
    // Still usable after the refusals.
    expect((await importer.storedShapeToStep(BOX, [])).solids).toBe(1);
  });
});

describe('placement matrices', () => {
  it('turn by a unit quaternion and normalise one that is not', () => {
    const m = placementMatrix({ position: [1, 2, 3], rotation: [0, 0, 2, 2] });
    // A quarter turn about z: x → y.
    [0, -1, 0, 1, 1, 0, 0, 2, 0, 0, 1, 3].forEach((v, i) => {
      expect(m[i]).toBeCloseTo(v, 12);
    });
    expect(chainMatrix([])).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  });
});

describe('measureStoredShape and measureBodies (S5)', () => {
  const box = (id: string, x: string): Feature => ({
    ...testFeature(id, 'box'),
    inputs: primitiveInputs('box', { numbers: { x } }),
  });

  it("is refused by a project's kernel", async () => {
    await expect(normal.measureStoredShape(BOX, [])).rejects.toThrow(/only an import's own kernel/);
    expect((await normal.stats()).liveShapes).toBe(0);
  });

  it('measures a stored shape where it is placed, with no STEP, leaving nothing', async () => {
    const at = await importer.measureStoredShape(boxBrep([1, 2, 3], [5, 7, 9]), [
      { position: [10, 0, 0], rotation: [0, 0, 0, 1] },
    ]);
    expect(at.solids).toBe(1);
    expect(at.volume).toBeCloseTo(120, 9);
    expect(at.area).toBeCloseTo(148, 9);
    expectBox(at.box, [11, 2, 3, 15, 7, 9]);
    const tall = await importer.measureStoredShape(cylinderBrep(50, [59.16, -59.16, 0]), []);
    expect(tall.volume).toBeCloseTo(Math.PI * 100 * 50, 6);
    expectBox(tall.box, [-10, -10, 0, 10, 10, 50]);
    await expect(importer.measureStoredShape('not a shape', [])).rejects.toThrow();
    expect((await importer.stats()).liveShapes).toBe(0);
  });

  it('measures rebuilt bodies with the same code as stored shapes', async () => {
    const result = await importer.recompute({ doc: testDocument([box('B', '-60 mm')]) });
    if (result.status !== 'done') throw new Error('not done');
    const id = result.bodies[0]?.id as BodyId;
    const measured = await importer.measureBodies([id]);
    const body = measured[id];
    if (!body) throw new Error('no measure');
    expect(body.solids).toBe(1);
    const stored = await importer.measureStoredShape(boxBrep(body.box.min, body.box.max), []);
    expect(stored.volume).toBeCloseTo(body.volume, 9);
    expect(stored.area).toBeCloseTo(body.area, 9);
    expectBox(stored.box, [...body.box.min, ...body.box.max], 9);
    await expect(importer.measureBodies(['nothing' as BodyId])).rejects.toThrow(/no longer/);
  });
});

describe('importRebuilder', () => {
  it('sends each file once, passes the versions back and measures only what is asked', async () => {
    const calls: string[] = [];
    let haveSeen: unknown[] = [];
    const api = {
      addFile: async (id: string) => {
        calls.push(`file ${id}`);
      },
      recompute: async (request: { have?: unknown }) => {
        haveSeen.push(request.have);
        return {
          status: 'done',
          features: { A: { status: 'ok' }, B: { status: 'error', message: 'no' } },
          bodies: [
            { id: 'A:0', version: 'v1' },
            { id: 'B:0', version: 'v2' },
          ],
        };
      },
      measureBodies: async (ids: string[]) => {
        calls.push(`measure ${ids.join(',')}`);
        return Object.fromEntries(ids.map((id) => [id, { solids: 1 }]));
      },
    } as unknown as Pick<KernelApi, 'addFile' | 'recompute' | 'measureBodies'>;
    const doc = {
      ...testDocument([]),
      attachments: {
        F: { name: 'f', fileName: 'f.step', mediaType: 'model/step', sha256: 'x', size: 1 },
      },
    } as never;
    const files = new Map([['F' as never, new Uint8Array([1])]]);
    const rebuilder = importRebuilder(api);
    const first = await rebuilder.rebuild(doc, files);
    const second = await rebuilder.rebuild(doc, files, ['A:0']);
    expect(calls).toEqual(['file F', 'measure A:0,B:0', 'measure B:0']);
    expect(haveSeen).toEqual([{}, { 'A:0': 'v1', 'B:0': 'v2' }]);
    expect(first.ids).toEqual(['A:0', 'B:0']);
    expect(second.bodies).toEqual({ 'B:0': { solids: 1 } });
    expect(first.failed).toEqual([{ feature: 'B', message: 'no' }]);
    haveSeen = [];
  });
});
