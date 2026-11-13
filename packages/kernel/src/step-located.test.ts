/**
 * The STEP writer keeps the solid of a shape whose root carries a location
 * (ADR-0034's fourth amendment, P6-25 S1). The three texts are B-rep shapes
 * we made with our own FreeCAD scripts: a disc extruded 100 mm (its face
 * located, its cylinder on an indirect frame with a seam), the same kind of
 * prism with an identity location on the solid, and one placed by a
 * translation and a quarter turn. Before the fix the last two came back from
 * STEP as faces with no solid.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeHandle } from './kernel';
import { loadOcct } from './occt/load';
import { IDENTITY_MOVED, LOCATED_FACE, LOCATED_FACE_PLACED } from './read-brep-test-support';
import { badEdgeUses } from './step-test-support';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

const SHAPES = {
  'a disc prism with a located face': LOCATED_FACE,
  'a prism whose solid carries an identity location': IDENTITY_MOVED,
  'a prism of a located face, the solid placed': LOCATED_FACE_PLACED,
};

/** Writes `shape` as STEP (plain, with a colour, and as an assembly part) and checks each file. */
function expectSameThroughStep(shape: ShapeHandle): void {
  using scope = kernel.scope();
  const volume = kernel.measure(shape).volume;
  const faces = kernel.describe(shape).faces.map((f) => f.centroid);
  const files = [
    kernel.writeStep([{ shape, name: 'Body' }]),
    kernel.writeStep([{ shape, name: 'Body', color: '#1080ff' }]),
    kernel.writeStep([{ shape, name: 'Body', group: 0 }], ['Group']),
  ];
  for (const text of files) {
    expect(badEdgeUses(text)).toEqual([]);
    const back = scope.track(kernel.readStep(text));
    const solids = kernel.solids(back);
    for (const s of solids) scope.track(s);
    expect(solids).toHaveLength(1);
    expect(kernel.isValid(back)).toBe(true);
    expect(Math.abs(kernel.measure(back).volume - volume)).toBeLessThan(1e-6 * volume);
    const after = kernel.describe(back).faces.map((f) => f.centroid);
    expect(after).toHaveLength(faces.length);
    after.forEach((c, i) => {
      c.forEach((v, j) => {
        expect(v).toBeCloseTo(faces[i]?.[j] as number, 6);
      });
    });
  }
}

describe('writeStep of located shapes', () => {
  for (const [what, text] of Object.entries(SHAPES)) {
    it(`keeps the solid of ${what}`, () => {
      using scope = kernel.scope();
      const shape = scope.track(kernel.readBrep(text));
      expect(kernel.solids(shape).map((s) => scope.track(s))).toHaveLength(1);
      expectSameThroughStep(shape);
    });
  }
});
