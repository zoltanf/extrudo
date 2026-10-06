/**
 * Trim and break on splines (ADR-0063's P4-12 amendment, A3): fit, control and
 * closed splines are cut by knot insertion into control splines with their own
 * knots, exactly their part of the curve.
 */
import {
  type BSpline,
  type SketchData,
  SketchDataSchema,
  type SketchEntityId,
  type SketchSpline,
  splineCurve,
  splinePoint,
  splinePolyline,
  type Vec2,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { splineParam } from '../export/bezier';
import { SketchBuilder } from '../fixtures';
import type { ModifyResult } from './change';
import { breakCurve, breakPreview, extend, trim, trimPreview } from './split';

const id = (s: string) => s as SketchEntityId;
let n = 0;
const newId = () => `n${n++}`;

function data(b: SketchBuilder): SketchData {
  return SketchDataSchema.parse({
    entities: b.entities,
    constraints: b.constraints,
    dimensions: b.dimensions,
  });
}

/** Applies a change as `modifySketch` does, and checks the result against the schema. */
function apply(d: SketchData, r: ModifyResult): SketchData {
  const entities = { ...d.entities };
  const constraints = { ...d.constraints };
  const dimensions = { ...d.dimensions };
  for (const x of r.remove?.dimensions ?? []) delete dimensions[x];
  for (const x of r.remove?.constraints ?? []) delete constraints[x];
  for (const x of r.remove?.entities ?? []) delete entities[x];
  Object.assign(entities, r.update, r.entities);
  Object.assign(constraints, r.replace?.constraints, r.constraints);
  Object.assign(dimensions, r.replace?.dimensions, r.dimensions);
  return SketchDataSchema.parse({ entities, constraints, dimensions });
}

const at = (d: SketchData, p: string): Vec2 => {
  const e = d.entities[id(p)];
  if (e?.type !== 'point') throw new Error(`${p} is not a point`);
  return [e.x, e.y];
};
const curveOf = (d: SketchData, s: string): BSpline => {
  const e = d.entities[id(s)] as SketchSpline;
  return splineCurve(
    e,
    e.points.map((p) => at(d, p)),
  );
};
const splines = (d: SketchData) =>
  Object.entries(d.entities).filter(([, e]) => e.type === 'spline') as [string, SketchSpline][];
const gap = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The farthest any point of `piece`'s fine polyline is from the curve `whole`. */
function offCurve(piece: BSpline, whole: BSpline): number {
  let worst = 0;
  for (const p of splinePolyline(piece, 32)) {
    worst = Math.max(worst, gap(p, splinePoint(whole, splineParam(whole, p))));
  }
  return worst;
}

const wave: [number, number][] = [
  [0, 0],
  [10, 12],
  [20, 2],
  [30, 14],
  [40, 4],
];

describe('trim on splines', () => {
  it('cuts a fit spline back to a line that crosses it, exactly its part of the curve', () => {
    const b = new SketchBuilder();
    const s = b.spline(wave);
    const v = b.line(25, -10, 25, 20);
    // A dimension and a constraint on the third fit point, which the cut takes away.
    b.constrain({ type: 'horizontal', a: s.points[2], b: s.points[1] });
    const before = data(b);
    const whole = curveOf(before, s.id);
    expect(trimPreview(before, id(s.id), [35, 8])).toHaveLength(1);
    const after = apply(before, trim(before, id(s.id), [35, 8], newId));
    const [[key, kept]] = splines(after) as [[string, SketchSpline]];
    // The first piece keeps the ID and is a control spline with knots from now on.
    expect(key).toBe(s.id);
    expect(kept).toMatchObject({ mode: 'control' });
    expect(kept.knots).toHaveLength(kept.points.length + 4);
    expect(offCurve(curveOf(after, key), whole)).toBeLessThan(1e-9);
    // It starts where the spline did (the same point) and ends on the line.
    expect(kept.points[0]).toBe(s.points[0]);
    const end = at(after, kept.points.at(-1) as string);
    expect(end[0]).toBeCloseTo(25, 9);
    expect(Object.values(after.constraints)).toContainEqual({
      type: 'pointOnCurve',
      point: kept.points.at(-1),
      curve: v.id,
    });
    // Fit points are not poles: the inner ones and the constraint on them are gone.
    for (const p of s.points.slice(1)) expect(after.entities[id(p)]).toBeUndefined();
    expect(Object.values(after.constraints).some((c) => c.type === 'horizontal')).toBe(false);
  });

  it('keeps both ends of a control spline crossed twice, and the poles away from the cuts', () => {
    const b = new SketchBuilder();
    const poles: [number, number][] = [
      [0, 0],
      [10, 20],
      [20, -10],
      [30, 20],
      [40, -10],
      [50, 20],
      [60, 0],
    ];
    const s = b.spline(poles, { mode: 'control' });
    b.line(15, -20, 15, 30);
    b.line(45, -20, 45, 30);
    b.constrain({ type: 'fix', entity: s.id });
    const before = data(b);
    const whole = curveOf(before, s.id);
    const after = apply(before, trim(before, id(s.id), [30, 5], newId));
    const pieces = splines(after);
    expect(pieces.map(([key]) => key)).toContain(s.id);
    expect(pieces).toHaveLength(2);
    for (const [key] of pieces) expect(offCurve(curveOf(after, key), whole)).toBeLessThan(1e-9);
    const all = pieces.flatMap(([, e]) => e.points);
    expect(all).toContain(s.points[0]);
    expect(all).toContain(s.points[6]);
    // The fix goes to every piece.
    const fixes = Object.values(after.constraints).filter((c) => c.type === 'fix');
    expect(fixes.map((c) => (c as { entity: string }).entity).sort()).toEqual(
      pieces.map(([key]) => key).sort(),
    );
  });

  it('opens a closed spline: the piece left runs round the seam', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
      { closed: true },
    );
    b.line(-10, 10, 40, 10);
    const before = data(b);
    const whole = curveOf(before, s.id);
    // The line cuts the loop at its two sides: trim the lower half away.
    const after = apply(before, trim(before, id(s.id), [15, 0], newId));
    const [[key, kept]] = splines(after) as [[string, SketchSpline]];
    expect(key).toBe(s.id);
    expect(kept.closed).toBeUndefined();
    expect(offCurve(curveOf(after, key), whole)).toBeLessThan(1e-9);
    // What is left is the upper half, from one crossing round the seam to the other.
    const ends = [at(after, kept.points[0] as string), at(after, kept.points.at(-1) as string)];
    for (const end of ends) expect(end[1]).toBeCloseTo(10, 9);
    expect(Math.min(...splinePolyline(curveOf(after, key)).map((p) => p[1]))).toBeGreaterThan(
      10 - 1e-9,
    );
  });

  it('takes a closed spline crossed once away whole, as a circle', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [30, 0],
        [30, 20],
      ],
      { closed: true },
    );
    // From below into the loop: one crossing.
    b.line(20, -30, 20, 6);
    const before = data(b);
    const after = apply(before, trim(before, id(s.id), [25, 5], newId));
    expect(splines(after)).toHaveLength(0);
    for (const p of s.points) expect(after.entities[id(p)]).toBeUndefined();
  });

  it('refuses a conic that other curves cross, and extending any spline', () => {
    const b = new SketchBuilder();
    const c = b.spline(
      [
        [0, 0],
        [10, 10],
        [20, 0],
      ],
      { mode: 'conic', rho: 0.4 },
    );
    const s = b.spline(wave);
    b.line(10, -10, 10, 20);
    const before = data(b);
    expect(() => trim(before, id(c.id), [5, 3], newId)).toThrow(/conic can't be cut/);
    expect(() => breakCurve(before, id(c.id), [5, 3], newId)).toThrow(/conic can't be cut/);
    expect(() => extend(before, id(s.id), [39, 4], newId)).toThrow(/can't be extended/);
  });
});

describe('break on splines', () => {
  it('splits a fit spline at the crossings around the cursor into three joined pieces', () => {
    const b = new SketchBuilder();
    const s = b.spline(wave);
    b.line(12, -10, 12, 20);
    b.line(28, -10, 28, 20);
    const before = data(b);
    const whole = curveOf(before, s.id);
    expect(breakPreview(before, id(s.id), [20, 3])).toHaveLength(1);
    const after = apply(before, breakCurve(before, id(s.id), [20, 3], newId));
    const pieces = splines(after);
    expect(pieces).toHaveLength(3);
    for (const [key] of pieces) expect(offCurve(curveOf(after, key), whole)).toBeLessThan(1e-9);
    expect(Object.values(after.constraints).filter((c) => c.type === 'coincident')).toHaveLength(2);
    expect(pieces[0]?.[0]).toBe(s.id);
  });

  it('opens a closed spline crossed once, its ends held together', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
      { mode: 'control', closed: true },
    );
    b.line(15, 5, 15, 40);
    const before = data(b);
    const whole = curveOf(before, s.id);
    const after = apply(before, breakCurve(before, id(s.id), [15, 15], newId));
    const [[key, piece]] = splines(after) as [[string, SketchSpline]];
    expect(key).toBe(s.id);
    expect(piece.closed).toBeUndefined();
    expect(offCurve(curveOf(after, key), whole)).toBeLessThan(1e-9);
    expect(Object.values(after.constraints)).toContainEqual({
      type: 'coincident',
      a: piece.points.at(-1),
      b: piece.points[0],
    });
  });

  it('breaks a closed spline crossed twice into two pieces of it', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
      { closed: true },
    );
    b.line(-10, 10, 40, 10);
    const before = data(b);
    const whole = curveOf(before, s.id);
    const after = apply(before, breakCurve(before, id(s.id), [32, 10], newId));
    const pieces = splines(after);
    expect(pieces).toHaveLength(2);
    for (const [key] of pieces) expect(offCurve(curveOf(after, key), whole)).toBeLessThan(1e-9);
    expect(Object.values(after.constraints).filter((c) => c.type === 'coincident')).toHaveLength(2);
  });
});
