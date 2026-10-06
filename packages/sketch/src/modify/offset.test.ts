/**
 * Offsetting splines (ADR-0063's P4-12 amendment, A4): a fit spline through
 * offsets of samples of the curve, within `OFFSET_TOLERANCE` of the true offset.
 */
import {
  type BSpline,
  type SketchData,
  SketchDataSchema,
  type SketchEntityId,
  type SketchSpline,
  splineCurve,
  splineDerivative,
  splinePoint,
  type Vec2,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { splineParam } from '../export/bezier';
import { SketchBuilder } from '../fixtures';
import type { ModifyResult } from './change';
import { chainOf, OFFSET_TOLERANCE, offset, offsetPreview, offsetTo } from './offset';

const id = (s: string) => s as SketchEntityId;
let n = 0;
const newId = () => `o${n++}`;
const options = { expr: '2 mm', format: (mm: number) => `${mm} mm` };

function data(b: SketchBuilder): SketchData {
  return SketchDataSchema.parse({
    entities: b.entities,
    constraints: b.constraints,
    dimensions: b.dimensions,
  });
}

function apply(d: SketchData, r: ModifyResult): SketchData {
  return SketchDataSchema.parse({
    entities: { ...d.entities, ...r.update, ...r.entities },
    constraints: { ...d.constraints, ...r.constraints },
    dimensions: { ...d.dimensions, ...r.dimensions },
  });
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
const newSplines = (before: SketchData, after: SketchData) =>
  Object.entries(after.entities).filter(
    ([key, e]) => e.type === 'spline' && !(key in before.entities),
  ) as [string, SketchSpline][];

/** The true offset of `curve` at `u`, `left` mm to the left of its direction. */
function trueOffset(curve: BSpline, u: number, left: number): Vec2 {
  const t = splinePoint(splineDerivative(curve), u);
  const len = Math.hypot(t[0], t[1]);
  const p = splinePoint(curve, u);
  return [p[0] - (t[1] / len) * left, p[1] + (t[0] / len) * left];
}

/** The worst distance from the true offset at 50 parameters to the offset curve. */
function worstError(original: BSpline, result: BSpline, left: number): number {
  let worst = 0;
  for (let i = 0; i < 50; i++) {
    const u = (i + 0.5) / 50;
    const p = trueOffset(original, u, left);
    const q = splinePoint(result, splineParam(result, p));
    worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return worst;
}

describe('offset of splines', () => {
  it('offsets an open control spline within the tolerance of the true offset', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [15, 25],
        [30, -10],
        [45, 20],
        [60, 0],
      ],
      { mode: 'control' },
    );
    const before = data(b);
    const chain = chainOf(before, id(s.id));
    expect(chain).toEqual({ links: [{ id: s.id, reversed: false }], closed: false });
    if (!chain) return;
    // Below the curve is to its right: a negative distance.
    expect(offsetTo(before, chain, [30, -20])).toBeLessThan(0);
    expect(offsetPreview(before, chain, 2)).toHaveLength(1);
    const after = apply(before, offset(before, chain, 2, options, newId));
    const [[key, made]] = newSplines(before, after) as [[string, SketchSpline]];
    expect(made.mode).toBeUndefined();
    expect(Object.values(after.constraints)).toContainEqual({ type: 'fix', entity: key });
    expect(Object.keys(after.dimensions)).toHaveLength(0);
    const error = worstError(curveOf(before, s.id), curveOf(after, key), 2);
    expect(error).toBeLessThan(OFFSET_TOLERANCE);
  });

  it('offsets a closed fit spline into a closed one inside it', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [40, -5],
        [50, 25],
        [20, 40],
        [-10, 20],
      ],
      { closed: true },
    );
    const before = data(b);
    const chain = chainOf(before, id(s.id));
    expect(chain).toEqual({ links: [{ id: s.id, reversed: false }], closed: true });
    if (!chain) return;
    // The loop runs counter-clockwise, so its inside is on the left.
    expect(offsetTo(before, chain, [20, 18])).toBeGreaterThan(0);
    const after = apply(before, offset(before, chain, 3, options, newId));
    const [[key, made]] = newSplines(before, after) as [[string, SketchSpline]];
    expect(made.closed).toBe(true);
    const error = worstError(curveOf(before, s.id), curveOf(after, key), 3);
    expect(error).toBeLessThan(OFFSET_TOLERANCE);
  });

  it('refuses an offset deeper than the tightest bend on its side', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [10, 10],
        [20, 0],
      ],
      { mode: 'control' },
    );
    const before = data(b);
    const chain = chainOf(before, id(s.id));
    if (!chain) throw new Error('no chain');
    // The apex bends with a radius of 10 mm, its centre below (on the right).
    expect(() => offset(before, chain, -12, options, newId)).toThrow(/tightest bend/);
    // Outwards it never collapses.
    expect(() => offset(before, chain, 12, options, newId)).not.toThrow();
  });

  it('offsets a spline with the line that closes it, trimmed to meet', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [10, 20],
        [30, 20],
        [40, 0],
      ],
      { mode: 'control' },
    );
    const base = b.line(40, 0, 0, 0);
    b.constrain({ type: 'coincident', a: s.points[3], b: base.start });
    b.constrain({ type: 'coincident', a: base.end, b: s.points[0] });
    const before = data(b);
    const chain = chainOf(before, id(s.id));
    expect(chain?.closed).toBe(true);
    expect(chain?.links.map((l) => l.id)).toEqual([s.id, base.id]);
    if (!chain) return;
    // The dome runs clockwise (left to right over the top): inside is on its right.
    const inward = offsetTo(before, chain, [20, 8]);
    expect(inward).toBeLessThan(0);
    const after = apply(before, offset(before, chain, -2, options, newId));
    const [[key]] = newSplines(before, after) as [[string, SketchSpline]];
    const lines = Object.entries(after.entities).filter(
      ([k, e]) => e.type === 'line' && !(k in before.entities),
    );
    expect(lines).toHaveLength(1);
    // The new base sits 2 mm up and runs between the offset spline's two ends.
    const line = lines[0]?.[1] as { start: string; end: string };
    for (const p of [line.start, line.end]) expect(at(after, p)[1]).toBeCloseTo(2, 9);
    const curve = curveOf(after, key);
    expect(splinePoint(curve, 0)[1]).toBeCloseTo(2, 6);
    expect(splinePoint(curve, 1)[1]).toBeCloseTo(2, 6);
    expect(Object.values(after.constraints).filter((c) => c.type === 'coincident')).toHaveLength(4);
  });

  it('carries a spline on along its tangent where the chain turns away (a convex corner)', () => {
    const b = new SketchBuilder();
    const s = b.spline(
      [
        [0, 0],
        [10, 20],
        [30, 20],
        [40, 0],
      ],
      { mode: 'control' },
    );
    const base = b.line(40, 0, 0, 0);
    b.constrain({ type: 'coincident', a: s.points[3], b: base.start });
    b.constrain({ type: 'coincident', a: base.end, b: s.points[0] });
    const before = data(b);
    const chain = chainOf(before, id(s.id));
    if (!chain) throw new Error('no chain');
    const after = apply(before, offset(before, chain, 2, options, newId));
    const lines = Object.entries(after.entities).filter(
      ([k, e]) => e.type === 'line' && !(k in before.entities),
    );
    // The base and one straight carry-on at each corner.
    expect(lines).toHaveLength(3);
  });
});
