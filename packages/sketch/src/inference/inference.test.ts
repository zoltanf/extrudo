import type { SketchData, SketchEntityId, Vec2 } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { alignmentConstraints, snapConstraints } from './constraints';
import { intersectCurves, nearestOnCurve, sketchCurves } from './geometry';
import { type Inference, infer } from './inference';

const TOL = 1;
const eid = (id: string) => id as SketchEntityId;

function near(actual: Vec2, expected: Vec2, digits = 9) {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

function curveOf(sketch: SketchData) {
  const curves = sketchCurves(sketch);
  return (id: string) => {
    const c = curves.find((x) => x.id === id);
    if (!c) throw new Error(`no curve ${id}`);
    return c;
  };
}

/** A line (0,0)–(20,0), a circle at (40,0) r 5, an arc at (0,30) r 10 from 0° to 90°. */
function scene() {
  const b = new SketchBuilder();
  const line = b.line(0, 0, 20, 0);
  const circle = b.circle(40, 0, 5);
  const arc = b.arc(0, 30, 10, 0, 90);
  const loose = b.point(60, 60);
  return { b, line, circle, arc, loose, sketch: b.sketch };
}

describe('geometry', () => {
  it('finds the nearest point on lines, circles and arcs', () => {
    const { sketch, line, circle, arc } = scene();
    const curve = curveOf(sketch);
    near(nearestOnCurve(curve(line.id), [5, 3]), [5, 0]);
    near(nearestOnCurve(curve(line.id), [-4, 1]), [0, 0]);
    near(nearestOnCurve(curve(circle.id), [40, 9]), [40, 5]);
    // Outside the arc's sweep: its nearer end.
    near(nearestOnCurve(curve(arc.id), [-3, 20]), [10, 30]);
    near(nearestOnCurve(curve(arc.id), [0, 45]), [0, 40]);
  });

  it('intersects every pair of curve kinds, within their extents', () => {
    const b = new SketchBuilder();
    const h = b.line(-10, 0, 10, 0);
    const v = b.line(0, -10, 0, 10);
    const short = b.line(20, -1, 20, 1);
    const c = b.circle(0, 0, 5);
    const c2 = b.circle(8, 0, 5);
    const arc = b.arc(0, 0, 5, 0, 90);
    const curve = curveOf(b.sketch);
    const cut = (x: string, y: string) => intersectCurves(curve(x), curve(y));
    expect(cut(h.id, v.id)).toHaveLength(1);
    near(cut(h.id, v.id)[0] ?? [NaN, NaN], [0, 0]);
    expect(cut(h.id, short.id)).toEqual([]);
    expect(cut(h.id, c.id)).toHaveLength(2);
    expect(cut(c.id, c2.id).map((p) => p[0])).toEqual([4, 4]);
    // The arc covers the first quadrant only: it meets the horizontal line at (5, 0).
    const hits = cut(h.id, arc.id);
    expect(hits).toHaveLength(1);
    near(hits[0] ?? [NaN, NaN], [5, 0]);
    expect(cut(arc.id, c2.id)).toHaveLength(1);
  });
});

describe('infer', () => {
  it('snaps to endpoints, centers, loose points and the origin', () => {
    const { sketch, line, circle, loose } = scene();
    const at = (p: Vec2) => infer(sketch, p, { tolerance: TOL });
    expect(at([20.4, 0.3]).snap).toMatchObject({ kind: 'endpoint', ids: [line.end] });
    expect(at([20.4, 0.3]).point).toEqual([20, 0]);
    expect(at([40.2, -0.5]).snap).toMatchObject({ kind: 'center', ids: [circle.center] });
    expect(at([59.5, 60.5]).snap).toMatchObject({ kind: 'point', ids: [loose] });
    // The line's start sits on the origin: the point wins over the origin.
    expect(at([0.1, 0.1]).snap?.kind).toBe('endpoint');
    const empty = new SketchBuilder().sketch;
    expect(infer(empty, [0.3, -0.2], { tolerance: TOL })).toMatchObject({
      point: [0, 0],
      snap: { kind: 'origin', ids: [] },
    });
  });

  it("snaps to an ellipse's center and points, and a spline's ends and fit points (P1-05)", () => {
    const b = new SketchBuilder();
    const e = b.ellipse(0, 0, 10, 4);
    const s = b.spline([
      [20, 0],
      [25, 5],
      [30, 0],
    ]);
    const at = (p: Vec2) => infer(b.sketch, p, { tolerance: TOL }).snap;
    expect(at([0.2, 0.2])).toMatchObject({ kind: 'center', ids: [e.center] });
    expect(at([10.2, 0.2])).toMatchObject({ kind: 'point', ids: [e.major] });
    expect(at([20.2, 0.2])).toMatchObject({ kind: 'endpoint', ids: [s.points[0]] });
    expect(at([25.2, 5.2])).toMatchObject({ kind: 'point', ids: [s.points[1]] });
    expect(at([30.2, 0.2])).toMatchObject({ kind: 'endpoint', ids: [s.points[2]] });
  });

  it('takes the nearest candidate when several are in range', () => {
    const b = new SketchBuilder();
    const p = b.point(0, 0);
    const q = b.point(1, 0);
    const r = infer(b.sketch, [0.7, 0], { tolerance: TOL });
    expect(r.snap?.ids).toEqual([q]);
    expect(infer(b.sketch, [0.3, 0], { tolerance: TOL }).snap?.ids).toEqual([p]);
  });

  it('prefers points over midpoints and intersections, and those over curves', () => {
    const b = new SketchBuilder();
    // Off the origin, so the midpoint isn't also the origin.
    const h = b.line(-10, 5, 10, 5);
    const v = b.line(3, -10, 3, 10);
    const mid = infer(b.sketch, [-0.2, 5.4], { tolerance: TOL });
    expect(mid.snap).toMatchObject({ kind: 'midpoint', ids: [h.id] });
    expect(mid.point).toEqual([0, 5]);
    const cross = infer(b.sketch, [3.3, 5.5], { tolerance: TOL });
    expect(cross.snap).toMatchObject({ kind: 'intersection', ids: [h.id, v.id] });
    near(cross.point, [3, 5]);
    const on = infer(b.sketch, [7, 5.6], { tolerance: TOL });
    expect(on.snap).toMatchObject({ kind: 'onCurve', ids: [h.id] });
    near(on.point, [7, 5]);
    // Near an end, the end wins over the line under the cursor.
    const e = infer(b.sketch, [9.2, 5], { tolerance: TOL });
    expect(e.snap?.kind).toBe('endpoint');
  });

  it("snaps to an arc's midpoint and to a point on a circle", () => {
    const { sketch, arc, circle } = scene();
    const mid = infer(sketch, [7.3, 37.2], { tolerance: TOL });
    expect(mid.snap).toMatchObject({ kind: 'midpoint', ids: [arc.id] });
    near(mid.point, [10 * Math.SQRT1_2, 30 + 10 * Math.SQRT1_2]);
    const on = infer(sketch, [45.6, 0.2], { tolerance: TOL });
    expect(on.snap).toMatchObject({ kind: 'onCurve', ids: [circle.id] });
    expect(Math.hypot(on.point[0] - 40, on.point[1])).toBeCloseTo(5, 9);
  });

  it('aligns horizontally and vertically with the anchor, then with sketch points', () => {
    const { sketch, loose } = scene();
    const anchor: Vec2 = [100, 100];
    const h = infer(sketch, [130, 100.6], { tolerance: TOL, anchor });
    expect(h.snap).toBeUndefined();
    expect(h.point).toEqual([130, 100]);
    expect(h.alignments).toEqual([
      { axis: 'horizontal', source: { kind: 'anchor' }, from: anchor },
    ]);
    const v = infer(sketch, [59.4, 90], { tolerance: TOL, anchor });
    expect(v.point).toEqual([60, 90]);
    expect(v.alignments).toEqual([
      { axis: 'vertical', source: { kind: 'point', id: loose }, from: [60, 60] },
    ]);
  });

  it('snaps to the crossing of a horizontal and a vertical guide', () => {
    const { sketch, loose } = scene();
    const r = infer(sketch, [60.5, 99.6], { tolerance: TOL, anchor: [100, 100] });
    expect(r.point).toEqual([60, 100]);
    expect(r.alignments.map((a) => [a.axis, a.source])).toEqual([
      ['horizontal', { kind: 'anchor' }],
      ['vertical', { kind: 'point', id: loose }],
    ]);
  });

  it('snaps to where an alignment guide crosses a curve', () => {
    const b = new SketchBuilder();
    const slanted = b.line(0, 0, 10, 20);
    // The guide y = 5 crosses the slanted line at (2.5, 5), away from its midpoint.
    const r = infer(b.sketch, [3, 5.4], { tolerance: TOL, anchor: [-20, 5] });
    expect(r.snap).toMatchObject({ kind: 'onCurve', ids: [slanted.id] });
    near(r.point, [2.5, 5]);
    expect(r.alignments).toHaveLength(1);
    expect(r.alignments[0]?.source).toEqual({ kind: 'anchor' });
  });

  it('snaps the free coordinate of a single alignment to the grid', () => {
    const r = infer(new SketchBuilder().sketch, [13.2, 20.4], {
      tolerance: TOL,
      anchor: [0, 20],
      grid: 5,
    });
    expect(r.point).toEqual([15, 20]);
  });

  it('falls back to the grid, then to the cursor', () => {
    const empty = new SketchBuilder().sketch;
    expect(infer(empty, [13.2, 21.9], { tolerance: TOL, grid: 5 })).toMatchObject({
      point: [15, 20],
      snap: { kind: 'grid' },
    });
    const free: Inference = infer(empty, [13.2, 21.9], { tolerance: TOL });
    expect(free).toEqual({
      point: [13.2, 21.9],
      cursor: [13.2, 21.9],
      snap: undefined,
      alignments: [],
    });
  });

  it('ignores excluded entities and can be switched off', () => {
    const { sketch, line, circle } = scene();
    const skip = infer(sketch, [20.4, 0.3], {
      tolerance: TOL,
      exclude: new Set([line.id, line.start, line.end]),
    });
    // Not the line's end: only the circle's center, level with the cursor.
    expect(skip.snap).toBeUndefined();
    expect(skip.point).toEqual([20.4, 0]);
    expect(skip.alignments[0]?.source).toEqual({ kind: 'point', id: circle.center });
    const off = infer(sketch, [20.4, 0.3], { tolerance: TOL, enabled: false, grid: 1 });
    expect(off.snap).toBeUndefined();
    expect(off.point).toEqual([20.4, 0.3]);
  });

  it('scales with the tolerance (pixels at the current zoom)', () => {
    const { sketch } = scene();
    expect(infer(sketch, [21.5, 0], { tolerance: 1 }).snap).toBeUndefined();
    expect(infer(sketch, [21.5, 0], { tolerance: 2 }).snap?.kind).toBe('endpoint');
  });
});

describe('auto-constraints', () => {
  const p = eid('new');
  it('turns each snap into the constraints that keep the point there', () => {
    const snap = (kind: never, ids: string[]) => snapConstraints({ kind, point: [0, 0], ids }, p);
    expect(snap('endpoint' as never, ['q'])).toEqual([{ type: 'coincident', a: p, b: 'q' }]);
    expect(snap('center' as never, ['q'])).toEqual([{ type: 'coincident', a: p, b: 'q' }]);
    expect(snap('midpoint' as never, ['l'])).toEqual([{ type: 'midpoint', point: p, of: 'l' }]);
    expect(snap('onCurve' as never, ['c'])).toEqual([
      { type: 'pointOnCurve', point: p, curve: 'c' },
    ]);
    expect(snap('intersection' as never, ['l', 'c'])).toEqual([
      { type: 'pointOnCurve', point: p, curve: 'l' },
      { type: 'pointOnCurve', point: p, curve: 'c' },
    ]);
    expect(snap('origin' as never, [])).toEqual([{ type: 'fix', entity: p }]);
    expect(snap('grid' as never, [])).toEqual([]);
    expect(snapConstraints(undefined, p)).toEqual([]);
  });

  it('puts an alignment with the anchor on the new line, others between points', () => {
    const anchor = { kind: 'anchor' } as const;
    const h = { axis: 'horizontal', source: anchor, from: [0, 0] } as const;
    const v = { axis: 'vertical', source: { kind: 'point', id: 'q' }, from: [0, 0] } as const;
    expect(alignmentConstraints([h, v], p, { line: eid('l') })).toEqual([
      { type: 'horizontal', a: 'l' },
      { type: 'vertical', a: p, b: 'q' },
    ]);
    expect(alignmentConstraints([h], p, { point: eid('s') })).toEqual([
      { type: 'horizontal', a: p, b: 's' },
    ]);
    expect(alignmentConstraints([h], p)).toEqual([]);
  });
});
