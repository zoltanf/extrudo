// Hidden-line spans (P6-24 S0, ADR-0143's amendment) against shapes whose
// views are known: a box from above and from a corner, a cylinder from the
// side and along its axis, and the polygonal run and HLRToShape on the box.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HlrEdge, Kernel, type ShapeHandle, type Vec3 } from './kernel';
import { loadOcct } from './occt/load';

let kernel: Kernel;

/** An edge's points (a degenerate edge has none). */
function pointsOf(shape: ShapeHandle, edge: number): Vec3[] {
  const g = kernel.edgeGeometry(shape, edge);
  return g.type === 'degenerate' ? [] : g.points;
}
let box: ShapeHandle;
let cylinder: ShapeHandle;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  box = kernel.box([10, 20, 30]);
  cylinder = kernel.cylinder(5, 20);
});
afterAll(() => kernel?.dispose());

const length = ([a, b]: [number, number]) => Math.abs(b - a);
const total = (spans: [number, number][]) => spans.reduce((sum, s) => sum + length(s), 0);
const zOf = (edge: number) => pointsOf(box, edge).map((p) => p[2]);

describe('hlrSpans', () => {
  it('sees a box from above: the top edges visible, the bottom ones hidden, the uprights end-on', () => {
    const view = kernel.hlrSpans(box, [0, 0, 1]);
    expect(view).toHaveLength(8);
    for (const e of view) {
      expect(e.kind).toBe('sharp');
      expect(e.edge).toBeDefined();
      const z = zOf(e.edge as number);
      const ink = e.visible.length > 0 ? e.visible : e.hidden;
      expect(ink).toHaveLength(1);
      const points = pointsOf(box, e.edge as number);
      const [p, q] = [points[0] as Vec3, points[points.length - 1] as Vec3];
      // Whole edges, in the edge's own parameter (a box's lines run 0 → their length).
      expect(length(ink[0] as [number, number])).toBeCloseTo(
        Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]),
        6,
      );
      expect(z.every((v) => Math.abs(v - (e.visible.length > 0 ? 30 : 0)) < 1e-9)).toBe(true);
      // A whole edge: its one span is its range.
      expect(ink[0]?.[0]).toBeCloseTo(e.range[0], 9);
      expect(ink[0]?.[1]).toBeCloseTo(e.range[1], 9);
    }
  });

  it('sees a box from a corner: nine edges visible and the three at the far corner hidden', () => {
    const view = kernel.hlrSpans(box, [1, 1, 1]);
    expect(view.filter((e) => e.visible.length > 0 && e.hidden.length === 0)).toHaveLength(9);
    const hidden = view.filter((e) => e.hidden.length > 0 && e.visible.length === 0);
    expect(hidden).toHaveLength(3);
    // The three hidden edges meet at the origin, the corner facing away.
    for (const e of hidden) {
      const points = pointsOf(box, e.edge as number);
      expect(points.some((p) => Math.hypot(...p) < 1e-9)).toBe(true);
    }
  });

  it('sees a cylinder from the side: two outlines on its side face, each circle half hidden', () => {
    const view = kernel.hlrSpans(cylinder, [1, 0, 0]);
    const outlines = view.filter((e) => e.kind === 'outline');
    expect(outlines).toHaveLength(2);
    const face = outlines[0]?.face;
    expect(face).toBeDefined();
    for (const o of outlines) {
      expect(o.edge).toBeUndefined();
      expect(o.face).toBe(face);
      expect(o.visible).toHaveLength(1);
      expect(o.curve?.type).toBe('line');
      const points = o.curve?.type === 'line' ? o.curve.points : [];
      // On the side, square to the view: x = 0, y = ±5, from z = 0 to 20.
      for (const p of points) {
        expect(p[0]).toBeCloseTo(0, 6);
        expect(Math.abs(p[1])).toBeCloseTo(5, 6);
      }
    }
    // The two circles keep their model edge; HLR splits them at the outlines.
    const circles = new Map<number, HlrEdge[]>();
    for (const e of view) {
      if (e.edge === undefined || e.kind !== 'sharp') continue;
      circles.set(e.edge, [...(circles.get(e.edge) ?? []), e]);
    }
    expect(circles.size).toBe(2);
    for (const pieces of circles.values()) {
      expect(pieces.length).toBeGreaterThan(1);
      for (const p of pieces) {
        expect(p.range[0]).toBeCloseTo(0, 9);
        expect(p.range[1]).toBeCloseTo(2 * Math.PI, 9);
      }
      expect(total(pieces.flatMap((p) => p.visible))).toBeCloseTo(Math.PI, 6);
      expect(total(pieces.flatMap((p) => p.hidden))).toBeCloseTo(Math.PI, 6);
    }
  });

  it('sees a cylinder along its axis: the near circle visible, the far one hidden, no outlines', () => {
    const view = kernel.hlrSpans(cylinder, [0, 0, 1]);
    expect(view.filter((e) => e.kind === 'outline')).toHaveLength(0);
    const visible = view.filter((e) => e.visible.length > 0);
    const hidden = view.filter((e) => e.hidden.length > 0);
    expect(visible).toHaveLength(1);
    expect(hidden).toHaveLength(1);
    expect(total(visible[0]?.visible ?? [])).toBeCloseTo(2 * Math.PI, 6);
    const near = pointsOf(cylinder, visible[0]?.edge as number);
    expect(near.every((p) => Math.abs(p[2] - 20) < 1e-9)).toBe(true);
  });

  it('refuses a direction with no length', () => {
    expect(() => kernel.hlrSpans(box, [0, 0, 0])).toThrow(/no length/);
  });
});

describe('hlrPolySpans and hlrToShapeCount', () => {
  it('sees the box from above the same way, in straight pieces that keep their edge', () => {
    // Pieces of the uprights project to points: leave them out.
    const pieces = kernel
      .hlrPolySpans(box, [0, 0, 1])
      .filter((p) => Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]) > 1e-6);
    const visible = pieces.filter((p) => p.visible && p.edge !== undefined);
    expect(visible.length).toBeGreaterThan(0);
    for (const p of visible)
      expect(zOf(p.edge as number).every((z) => Math.abs(z - 30) < 1e-9)).toBe(true);
    const hidden = pieces.filter((p) => !p.visible && p.edge !== undefined);
    for (const p of hidden)
      expect(zOf(p.edge as number).every((z) => Math.abs(z) < 1e-9)).toBe(true);
  });

  it('builds as many edges in HLRToShape as there are spans', () => {
    expect(kernel.hlrToShapeCount(box, [0, 0, 1])).toBe(8);
  });
});
