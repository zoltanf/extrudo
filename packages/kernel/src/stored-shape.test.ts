/**
 * `storedShapeToStep` (P6-25 S3, ADR-0144 decision 5): only an import kernel
 * reads B-rep text; it places the shape, writes STEP and reads it back, and
 * leaves nothing alive.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct } from './occt/load';
import { BOX, LOCATED_FACE_PLACED } from './read-brep-test-support';
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
