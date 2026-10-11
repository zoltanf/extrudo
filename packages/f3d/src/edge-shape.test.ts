/**
 * Edge geometry from surfaces (cm in, mm out): a box edge, a box edge ended
 * by fillets, a fillet's arc where it meets a side, and a hole's rim; where
 * the surfaces meet in two lines or in a curve not followed, the edges the
 * file's B-rep holds between the faces decide.
 */
import { describe, expect, it } from 'vitest';
import type { AsmSurface } from './asm';
import type { Vec3 } from './decode/sketch-geometry';
import { continues, edgeShape } from './edge-shape';
import type { F3dEdge, F3dFace, KnownEdge } from './model';

const face = (surface: AsmSurface): F3dFace => ({ tags: [], surface });
const plane = (point: Vec3, normal: Vec3) => face({ kind: 'plane', point, normal });
const cylinder = (center: Vec3, axis: Vec3, radius: number) =>
  face({ kind: 'cone', center, axis, radius, cylinder: true, slope: 0 });
const cone = (center: Vec3, axis: Vec3, radius: number, slope: number) =>
  face({ kind: 'cone', center, axis, radius, cylinder: false, slope });
const edge = (a: F3dFace, b: F3dFace, bounds: F3dFace[], known?: KnownEdge[]): F3dEdge => ({
  faces: [a, b],
  bounds,
  ...(known ? { known } : {}),
});
const knownLine = (from: Vec3, to: Vec3): KnownEdge => ({
  curve: {
    kind: 'line',
    point: from,
    direction: [to[0] - from[0], to[1] - from[1], to[2] - from[2]],
  },
  points: [from, to],
});

describe('edgeShape', () => {
  it('ends a line where the bounding planes cross it', () => {
    // A 4 × 2 × 1 cm box's top edge along X, at y = 2, z = 1.
    const e = edge(plane([0, 0, 1], [0, 0, 1]), plane([0, 2, 0], [0, 1, 0]), [
      plane([0, 0, 0], [-1, 0, 0]),
      plane([4, 0, 0], [1, 0, 0]),
    ]);
    expect(edgeShape(e)).toMatchObject({
      type: 'line',
      at: [20, 20, 10],
      dir: [1, 0, 0],
      size: 40,
    });
  });

  it('ends a line where it touches the fillets at its ends', () => {
    // The same edge, with 0.5 cm fillets along the box's two upright ends.
    const e = edge(plane([0, 0, 1], [0, 0, 1]), plane([0, 2, 0], [0, 1, 0]), [
      cylinder([0.5, 1.5, 0], [0, 0, 1], 0.5),
      cylinder([3.5, 1.5, 0], [0, 0, 1], 0.5),
    ]);
    expect(edgeShape(e)).toMatchObject({ type: 'line', at: [20, 20, 10], size: 30 });
  });

  it('takes the quarter arc where a fillet meets a side', () => {
    // A 0.5 cm fillet along Y on the top edge x = 4, z = 1; the side y = 0 cuts it.
    const e = edge(plane([0, 0, 0], [0, -1, 0]), cylinder([3.5, 0, 0.5], [0, 1, 0], 0.5), [
      plane([0, 0, 1], [0, 0, 1]),
      plane([4, 0, 0], [1, 0, 0]),
    ]);
    const s = edgeShape(e);
    const h = 5 * Math.SQRT1_2;
    expect(s?.type).toBe('circle');
    expect(s?.dir).toEqual([0, 1, 0]);
    expect(s?.at[0]).toBeCloseTo(35 + h, 5);
    expect(s?.at[1]).toBeCloseTo(0, 6);
    expect(s?.at[2]).toBeCloseTo(5 + h, 5);
    expect(s?.size).toBeCloseTo((Math.PI / 2) * 5, 5);
  });

  it('gives a whole circle its centre and circumference', () => {
    const e = edge(plane([0, 0, 1], [0, 0, 1]), cylinder([1, 1, 0], [0, 0, -1], 0.25), []);
    const s = edgeShape(e);
    expect(s).toMatchObject({ type: 'circle', at: [10, 10, 10], dir: [0, 0, 1] });
    expect(s?.size).toBeCloseTo(Math.PI * 5, 6);
    expect(s?.ends).toBeUndefined();
  });

  it("finds a countersink's rims on the top face and on the hole", () => {
    // 90°, drilled down from z = 1.2: radius 0.4 cm at z = 1.075, narrowing downwards.
    const sink = cone([2, 5, 1.075], [0, 0, -1], 0.4, -1);
    const top = edgeShape(edge(plane([0, 0, 1.2], [0, 0, 1]), sink, []));
    expect(top).toMatchObject({ type: 'circle', at: [20, 50, 12], dir: [0, 0, 1] });
    expect(top?.size).toBeCloseTo(2 * Math.PI * 5.25, 6);
    const hole = edgeShape(edge(sink, cylinder([2, 5, 0], [0, 0, 1], 0.25), []));
    expect(hole).toMatchObject({ type: 'circle', at: [20, 50, 9.25] });
    expect(hole?.size).toBeCloseTo(2 * Math.PI * 2.5, 6);
  });

  // A tooth's side (the plane x = 0.15) crosses the 1.85 cm root cylinder in
  // two lines, at y = ±1.844; the caps z = 0 and 1 end them.
  const side = plane([0.15, 0, 0], [1, 0, 0]);
  const root = cylinder([0, 0, 0], [0, 0, 1], 1.85);
  const caps = [plane([0, 0, 0], [0, 0, -1]), plane([0, 0, 1], [0, 0, 1])];
  const y = Math.sqrt(1.85 ** 2 - 0.15 ** 2);

  it('takes the one of two crossing lines the B-rep holds an edge on', () => {
    const s = edgeShape(edge(side, root, caps, [knownLine([0.15, y, 0], [0.15, y, 1])]));
    expect(s?.type).toBe('line');
    expect(s?.at[0]).toBeCloseTo(1.5, 6);
    expect(s?.at[1]).toBeCloseTo(y * 10, 6);
    expect(s?.at[2]).toBeCloseTo(5, 6);
    expect(s?.size).toBeCloseTo(10, 6);
  });

  it('gives no shape for two crossing lines when nothing tells them apart', () => {
    expect(edgeShape(edge(side, root, caps))).toBeUndefined();
    // Both lines held (two states): still not told apart.
    const both = [knownLine([0.15, y, 0], [0.15, y, 1]), knownLine([0.15, -y, 0], [0.15, -y, 1])];
    expect(edgeShape(edge(side, root, caps, both))).toBeUndefined();
  });

  it('takes the line where two cylinders cross', () => {
    // Two 1 cm cylinders 1.2 cm apart cross at x = 0.6, y = ±0.8.
    const a = cylinder([0, 0, 0], [0, 0, 1], 1);
    const b = cylinder([1.2, 0, 0], [0, 0, 1], 1);
    const s = edgeShape(edge(a, b, caps, [knownLine([0.6, -0.8, 1], [0.6, -0.8, 0])]));
    expect(s).toMatchObject({ type: 'line', dir: [0, 0, 1] });
    expect(s?.at[0]).toBeCloseTo(6, 6);
    expect(s?.at[1]).toBeCloseTo(-8, 6);
  });

  it("follows a known edge's line where the surfaces are not followed", () => {
    const torus = face({ kind: 'other', type: 'torus-surface' });
    const s = edgeShape(edge(torus, side, caps, [knownLine([0.15, 1, 0], [0.15, 1, 1])]));
    expect(s).toMatchObject({ type: 'line', at: [1.5, 10, 5], dir: [0, 0, 1], size: 10 });
  });

  it('takes the stretch a known edge spans where a bounding cylinder cuts the line twice', () => {
    // A stadium's straight side y = −0.2 between two r 2.2472 cylinders whose
    // centres are 2.2 cm off the line: each cuts it twice; the side runs out to the far cuts.
    const top = plane([0, 0, 0], [0, 0, 1]);
    const flat = plane([0, -0.2, 0], [0, -1, 0]);
    const ends = [
      cylinder([2.0472, 2, 0], [0, 0, -1], 2.2472),
      cylinder([5.3528, 2, 0], [0, 0, -1], 2.2472),
    ];
    const half = Math.sqrt(2.2472 ** 2 - 2.2 ** 2);
    const from: Vec3 = [2.0472 - half, -0.2, 0];
    const to: Vec3 = [5.3528 + half, -0.2, 0];
    expect(edgeShape(edge(top, flat, ends))?.size).toBeCloseTo((3.3056 - 2 * half) * 10, 4);
    expect(edgeShape(edge(top, flat, ends, [knownLine(to, from)]))?.size).toBeCloseTo(
      (3.3056 + 2 * half) * 10,
      4,
    );
  });

  it("measures a pattern copy's edge where the copy is", () => {
    const at = (f: F3dFace, own: AsmSurface): F3dFace => ({
      ...f,
      instance: { pattern: 9, code: 2 },
      own,
    });
    const e = edge(
      at(plane([0, 0, 1], [0, 0, 1]), { kind: 'plane', point: [0, 0, 3], normal: [0, 0, 1] }),
      at(plane([0, 2, 0], [0, 1, 0]), { kind: 'plane', point: [0, 2, 0], normal: [0, 1, 0] }),
      [plane([0, 0, 0], [-1, 0, 0]), plane([4, 0, 0], [1, 0, 0])],
    );
    expect(edgeShape(e)).toMatchObject({ type: 'line', at: [20, 20, 30], size: 40 });
  });

  it('cuts an ellipse where a plane slants across a cylinder', () => {
    // The 1 cm cylinder about Z, cut by the plane z = 1 + y (45°): an ellipse
    // (sin t, −cos t, 1 − cos t); the planes x = 0.3 and y = −0.9 end the arc
    // from t = asin 0.3 to acos 0.9.
    const s = Math.SQRT1_2;
    const e = edge(plane([0, 0, 1], [0, -s, s]), cylinder([0, 0, 0], [0, 0, 1], 1), [
      plane([0.3, 0, 0], [1, 0, 0]),
      plane([0, -0.9, 0], [0, -1, 0]),
    ]);
    const shape = edgeShape(e);
    expect(shape?.type).toBe('ellipse');
    expect(shape?.dir[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(shape?.dir[2]).toBeCloseTo(-Math.SQRT1_2, 6);
    const t = (Math.asin(0.3) + Math.acos(0.9)) / 2;
    expect(shape?.at[0]).toBeCloseTo(10 * Math.sin(t), 5);
    expect(shape?.at[1]).toBeCloseTo(-10 * Math.cos(t), 5);
    expect(shape?.at[2]).toBeCloseTo(10 * (1 - Math.cos(t)), 5);
    // ∫ √(1 + sin² t) dt over the arc, × 10 mm
    expect(shape?.size).toBeCloseTo(1.560518, 4);
  });

  it('tells a tangent chain from a corner', () => {
    // A short arc of the 1 cm circle about Z from (1, 0, 0), and lines at (1, 0, 0).
    const arc = edgeShape(
      edge(plane([0, 0, 0], [0, 0, 1]), cylinder([0, 0, 0], [0, 0, 1], 1), [
        plane([0, 0, 0], [0, -1, 0]),
        plane([0.8, 0.6, 0], [0.8944272, 0.4472136, 0]),
      ]),
    );
    const along = edgeShape(
      edge(plane([0, 0, 0], [0, 0, 1]), plane([1, 0, 0], [1, 0, 0]), [
        plane([0, 0, 0], [0, 1, 0]),
        plane([0, -1, 0], [0, -1, 0]),
      ]),
    );
    const across = edgeShape(
      edge(plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 0], [0, -1, 0]), [
        plane([1, 0, 0], [-1, 0, 0]),
        plane([2, 0, 0], [1, 0, 0]),
      ]),
    );
    if (!arc || !along || !across) throw new Error('no shape');
    expect(continues(arc, along)).toBe(true);
    expect(continues(along, arc)).toBe(true);
    expect(continues(arc, across)).toBe(false);
  });
});
