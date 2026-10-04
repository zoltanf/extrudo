import {
  type SketchConstraint,
  type SketchData,
  SketchDataSchema,
  type SketchDimension,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SketchBuilder } from '../fixtures';
import { loadPlanegcs } from '../solver/module';
import { SketchSolver } from '../solver/solver';
import type { ModifyResult } from './change';
import { chamfer, cornerAtPoint, cornerOf, fillet, maxFilletRadius } from './corner';
import { chainOf, offset, offsetTo } from './offset';
import { breakCurve, extend, trim, trimPreview } from './split';
import {
  circularPattern,
  copy,
  mirror,
  rectangularPattern,
  scale,
  scaleExpression,
} from './transform';

let solver: SketchSolver;
beforeAll(async () => {
  solver = new SketchSolver(await loadPlanegcs());
});
afterAll(() => solver.dispose());

const id = (s: string) => s as SketchEntityId;
let n = 0;
const newId = () => `n${n++}`;

/**
 * Applies a result the way the tool host does: links resolved to the
 * target's expression, and `auto` items dropped where the solver finds them
 * redundant or conflicting.
 */
function apply(data: SketchData, result: ModifyResult): SketchData {
  const r = {
    ...result,
    constraints: { ...result.constraints },
    dimensions: { ...result.dimensions },
  };
  const auto = new Set(result.auto ?? []);
  for (const key of auto) {
    delete (r.constraints as Record<string, unknown>)[key];
    delete (r.dimensions as Record<string, unknown>)[key];
  }
  let out = merge(data, r);
  for (const key of result.auto ?? []) {
    const c = result.constraints?.[key as never];
    const d = result.dimensions?.[key as never];
    const trial = merge(data, {
      ...r,
      constraints: { ...r.constraints, ...(c ? { [key]: c } : {}) },
      dimensions: { ...r.dimensions, ...(d ? { [key]: d } : {}) },
    });
    if (solver.check(trial, values(trial), key).accepted) {
      if (c) (r.constraints as Record<string, unknown>)[key] = c;
      if (d) (r.dimensions as Record<string, unknown>)[key] = d;
      out = trial;
    }
  }
  return out;
}

function merge(data: SketchData, r: ModifyResult): SketchData {
  const entities = { ...data.entities };
  const constraints = { ...data.constraints };
  const dimensions = { ...data.dimensions };
  for (const x of r.remove?.dimensions ?? []) delete dimensions[x];
  for (const x of r.remove?.constraints ?? []) delete constraints[x];
  for (const x of r.remove?.entities ?? []) delete entities[x];
  Object.assign(entities, r.update, r.entities);
  Object.assign(constraints, r.replace?.constraints, r.constraints);
  Object.assign(dimensions, r.replace?.dimensions, r.dimensions);
  for (const [key, link] of Object.entries(r.links ?? {})) {
    const target = dimensions[link as never] as SketchDimension;
    const d = dimensions[key as never] as SketchDimension | undefined;
    if (d) dimensions[key as never] = { ...d, expr: target.expr };
  }
  for (const [key, expr] of Object.entries(r.exprs ?? {})) {
    dimensions[key as never] = { ...(dimensions[key as never] as SketchDimension), expr };
  }
  return SketchDataSchema.parse({
    entities,
    constraints,
    dimensions,
    ...(data.projections && { projections: data.projections }),
  });
}

/** Every dimension's expression read as a number of mm or degrees. */
function values(data: SketchData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, d] of Object.entries(data.dimensions)) {
    if (!d.driven) out[key] = Number.parseFloat(d.expr);
  }
  return out;
}

function solve(data: SketchData) {
  return solver.solve(data, values(data));
}

/** Solves and expects a clean result: converged, nothing conflicting or redundant. */
function clean(data: SketchData) {
  const r = solve(data);
  expect(r.conflicting).toEqual([]);
  expect(r.redundant).toEqual([]);
  expect(r.partlyRedundant).toEqual([]);
  expect(r.ok).toBe(true);
  return r;
}

const at = (data: SketchData, p: string): Vec2 => {
  const e = data.entities[id(p)];
  if (e?.type !== 'point') throw new Error(`${p} is not a point`);
  return [e.x, e.y];
};
const types = (data: SketchData) =>
  Object.values(data.entities)
    .map((e) => e.type)
    .filter((t) => t !== 'point')
    .sort();
const constraintTypes = (data: SketchData) =>
  Object.values(data.constraints)
    .map((c) => c.type)
    .sort();
const ends = (data: SketchData, line: string): [Vec2, Vec2] => {
  const e = data.entities[id(line)];
  if (e?.type !== 'line') throw new Error(`${line} is not a line`);
  return [at(data, e.start), at(data, e.end)];
};
const round = (p: Vec2): Vec2 => [
  Math.round(p[0] * 1e6) / 1e6 + 0,
  Math.round(p[1] * 1e6) / 1e6 + 0,
];

function data(b: SketchBuilder): SketchData {
  return SketchDataSchema.parse({
    entities: b.entities,
    constraints: b.constraints,
    dimensions: b.dimensions,
  });
}

describe('trim', () => {
  it('cuts a line back to where another crosses it, and puts the new end on that line', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 20, 0);
    const v = b.line(10, -10, 10, 10);
    b.constrain({ type: 'horizontal', a: h.id });
    const before = data(b);
    expect(trimPreview(before, id(h.id), [15, 0])).toEqual([
      [
        [10, 0],
        [20, 0],
      ],
    ]);
    const after = apply(before, trim(before, id(h.id), [15, 0], newId));
    expect(ends(after, h.id).map(round)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    // The old end went; the new one sits on the vertical line.
    expect(after.entities[id(h.end)]).toBeUndefined();
    expect(constraintTypes(after)).toEqual(['horizontal', 'pointOnCurve']);
    const on = Object.values(after.constraints).find((c) => c.type === 'pointOnCurve');
    expect(on).toMatchObject({ curve: v.id });
    clean(after);
  });

  it('takes the middle out of a line: two collinear pieces, each held at its crossing', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 30, 0);
    b.line(10, -10, 10, 10);
    b.line(20, -10, 20, 10);
    b.constrain({ type: 'horizontal', a: h.id });
    b.constrain({ type: 'fix', entity: h.start });
    b.dimension({ type: 'distance', orientation: 'aligned', a: h.id }, 30);
    const before = data(b);
    const dof = solve(before).dof;
    const after = apply(before, trim(before, id(h.id), [15, 0.1], newId));
    expect(types(after)).toEqual(['line', 'line', 'line', 'line']);
    // The line's length no longer means anything; the old end stays with the far piece.
    expect(Object.keys(after.dimensions)).toEqual([]);
    expect(ends(after, h.id).map(round)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    const far = Object.entries(after.entities).find(
      ([, e]) => e.type === 'line' && e.end === h.end,
    );
    expect(far && ends(after, far[0]).map(round)).toEqual([
      [20, 0],
      [30, 0],
    ]);
    expect(constraintTypes(after)).toEqual([
      'collinear',
      'fix',
      'horizontal',
      'pointOnCurve',
      'pointOnCurve',
    ]);
    // The line's length held its far end; now that end can slide. The cut ends are held.
    const r = clean(after);
    expect(r.dof).toBe(dof + 1);
  });

  it('deletes a curve nothing crosses, with its constraints', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 20, 0);
    b.line(0, 5, 20, 5);
    b.constrain({ type: 'horizontal', a: h.id });
    const before = data(b);
    const after = apply(before, trim(before, id(h.id), [5, 0], newId));
    expect(types(after)).toEqual(['line']);
    expect(after.entities[id(h.start)]).toBeUndefined();
    expect(after.constraints).toEqual({});
  });

  it('turns a circle crossed twice into the arc away from the cursor, keeping its ID and radius', () => {
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 10);
    const cut = b.line(-20, 5, 20, 5);
    b.dimension({ type: 'radius', curve: c.id }, 10);
    const before = data(b);
    // Trim the cap above the line.
    const after = apply(before, trim(before, id(c.id), [0, 10], newId));
    const arc = after.entities[id(c.id)];
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') return;
    expect(arc.center).toBe(c.center);
    const s = round(at(after, arc.start));
    const e = round(at(after, arc.end));
    const x = Math.sqrt(75);
    // Counter-clockwise from the right crossing... no: from the left crossing round below to the right.
    expect(s).toEqual(round([-x, 5]));
    expect(e).toEqual(round([x, 5]));
    expect(Object.values(after.constraints)).toEqual([
      { type: 'pointOnCurve', point: arc.start, curve: cut.id },
      { type: 'pointOnCurve', point: arc.end, curve: cut.id },
    ]);
    expect(Object.keys(after.dimensions)).toHaveLength(1);
    clean(after);
  });

  it('deletes a circle crossed only once', () => {
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 10);
    b.line(10, -5, 10, 5);
    const before = data(b);
    const after = apply(before, trim(before, id(c.id), [-10, 0], newId));
    expect(types(after)).toEqual(['line']);
  });

  it('splits an arc into two concentric arcs of equal radius', () => {
    const b = new SketchBuilder();
    const a = b.arc(0, 0, 10, 0, 180);
    b.line(-20, 5, 20, 5);
    const before = data(b);
    const after = apply(before, trim(before, id(a.id), [0, 10], newId));
    expect(types(after)).toEqual(['arc', 'arc', 'line']);
    expect(constraintTypes(after)).toEqual(['concentric', 'equal', 'pointOnCurve', 'pointOnCurve']);
    clean(after);
  });

  it('joins a new end to the crossing curve’s own end when they meet there', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 20, 0);
    const t = b.line(10, 0, 10, 10);
    const before = data(b);
    const after = apply(before, trim(before, id(h.id), [15, 0], newId));
    const joined = Object.values(after.constraints);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ type: 'coincident', b: t.start });
    clean(after);
  });

  it('moves a point held on the trimmed part of a line, or drops what held it', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 30, 0);
    b.line(10, -10, 10, 10);
    b.line(20, -10, 20, 10);
    const kept = b.point(25, 0);
    const lost = b.point(15, 0);
    b.constrain({ type: 'pointOnCurve', point: kept, curve: h.id });
    b.constrain({ type: 'pointOnCurve', point: lost, curve: h.id });
    const before = data(b);
    const after = apply(before, trim(before, id(h.id), [15, 0], newId));
    const on = Object.values(after.constraints).filter(
      (c): c is Extract<SketchConstraint, { type: 'pointOnCurve' }> =>
        c.type === 'pointOnCurve' && (c.point === kept || c.point === lost),
    );
    expect(on).toHaveLength(1);
    // The point past the gap now lies on the new far piece.
    expect(on[0]?.point).toBe(kept);
    expect(on[0]?.curve).not.toBe(h.id);
    expect(after.entities[on[0]?.curve as SketchEntityId]?.type).toBe('line');
  });

  it("refuses to cut an ellipse that other curves cross, and deletes one they don't", () => {
    const b = new SketchBuilder();
    const e = b.ellipse(0, 0, 10, 5);
    const l = b.line(-20, 0, 20, 0);
    const before = data(b);
    expect(() => trim(before, id(e.id), [0, 5], newId)).toThrow(/lines, circles and arcs/);
    expect(types(apply(before, trim(before, id(l.id), [0, 0], newId)))).toEqual([
      'ellipse',
      'line',
      'line',
    ]);
    const b2 = new SketchBuilder();
    const e2 = b2.ellipse(0, 0, 10, 5);
    const d2 = data(b2);
    expect(types(apply(d2, trim(d2, id(e2.id), [10, 0], newId)))).toEqual([]);
  });
});

describe('break', () => {
  it('splits a line at the crossings around the cursor into joined, collinear pieces', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 30, 0);
    b.line(10, -10, 10, 10);
    b.line(20, -10, 20, 10);
    b.constrain({ type: 'horizontal', a: h.id });
    const before = data(b);
    const dof = solve(before).dof;
    const after = apply(before, breakCurve(before, id(h.id), [15, 0], newId));
    expect(types(after)).toEqual(['line', 'line', 'line', 'line', 'line']);
    expect(constraintTypes(after)).toEqual([
      'coincident',
      'coincident',
      'horizontal',
      'parallel',
      'parallel',
    ]);
    // Two more pieces with 4 unknowns each, held by a joint (2) and parallel (1) each... plus
    // the owner's shorter length: the same shape moves the same ways, plus each break point slides.
    expect(clean(after).dof).toBe(dof + 2);
  });

  it('breaks a circle into two arcs of the same circle', () => {
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 10);
    b.line(-20, 5, 20, 5);
    const before = data(b);
    const after = apply(before, breakCurve(before, id(c.id), [0, 10], newId));
    expect(types(after)).toEqual(['arc', 'arc', 'line']);
    expect(constraintTypes(after)).toEqual(['coincident', 'coincident', 'equal']);
    clean(after);
  });

  it('refuses where nothing crosses', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 30, 0);
    const before = data(b);
    expect(() => breakCurve(before, id(h.id), [15, 0], newId)).toThrow(/Nothing crosses/);
  });
});

describe('extend', () => {
  it('lengthens a line to the next curve in its way and puts the end on it', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 10, 0);
    const near = b.line(15, -10, 15, 10);
    b.line(25, -10, 25, 10);
    b.dimension({ type: 'distance', orientation: 'aligned', a: h.id }, 10);
    const before = data(b);
    const after = apply(before, extend(before, id(h.id), [9, 0], newId));
    expect(ends(after, h.id).map(round)).toEqual([
      [0, 0],
      [15, 0],
    ]);
    expect(Object.keys(after.dimensions)).toEqual([]);
    expect(Object.values(after.constraints)).toEqual([
      expect.objectContaining({ type: 'pointOnCurve', curve: near.id }),
    ]);
    clean(after);
  });

  it('extends the start when the cursor is nearer it', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 10, 0);
    b.circle(-10, 0, 5);
    const before = data(b);
    const after = apply(before, extend(before, id(h.id), [1, 0], newId));
    expect(ends(after, h.id).map(round)).toEqual([
      [-5, 0],
      [10, 0],
    ]);
  });

  it('extends an arc round its circle', () => {
    const b = new SketchBuilder();
    const a = b.arc(0, 0, 10, 0, 90);
    b.line(-20, 0, 0, 0);
    const before = data(b);
    const after = apply(before, extend(before, id(a.id), [0, 10], newId));
    const arc = after.entities[id(a.id)];
    if (arc?.type !== 'arc') throw new Error('not an arc');
    expect(round(at(after, arc.end))).toEqual([-10, 0]);
    clean(after);
  });

  it('refuses when nothing is in the way', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 10, 0);
    const before = data(b);
    expect(() => extend(before, id(h.id), [9, 0], newId)).toThrow(/nothing for it to reach/);
  });
});

/** A 40 × 20 rectangle from the origin: fixed corner, horizontal and vertical sides, width and height. */
function rectangle() {
  const b = new SketchBuilder();
  const bottom = b.line(0, 0, 40, 0);
  const right = b.line(40, 0, 40, 20);
  const top = b.line(40, 20, 0, 20);
  const left = b.line(0, 20, 0, 0);
  const sides = [bottom, right, top, left];
  sides.forEach((l, i) => {
    const next = sides[(i + 1) % 4] as typeof l;
    b.constrain({ type: 'coincident', a: l.end, b: next.start });
    b.constrain({ type: i % 2 === 0 ? 'horizontal' : 'vertical', a: l.id });
  });
  b.constrain({ type: 'fix', entity: bottom.start });
  b.dimension({ type: 'distance', orientation: 'aligned', a: bottom.id }, 40);
  b.dimension({ type: 'distance', orientation: 'aligned', a: right.id }, 20);
  return { b, bottom, right, top, left };
}

describe('fillet and chamfer', () => {
  it('rounds a rectangle corner and keeps it fully constrained, sizes kept through the sharp', () => {
    const { b, bottom, right } = rectangle();
    const before = data(b);
    expect(clean(before).dof).toBe(0);
    const corner = cornerOf(before, id(bottom.id), id(right.id), [20, 0], [40, 10]);
    expect(corner).toBeDefined();
    if (!corner) return;
    expect(corner.sharp).toEqual([40, 0]);
    expect(maxFilletRadius(corner)).toBeCloseTo(20, 9);
    const after = apply(before, fillet(before, corner, 5, '5', newId));
    expect(types(after)).toEqual(['arc', 'line', 'line', 'line', 'line']);
    expect(ends(after, bottom.id).map(round)).toEqual([
      [0, 0],
      [35, 0],
    ]);
    expect(ends(after, right.id).map(round)).toEqual([
      [40, 5],
      [40, 20],
    ]);
    // The width now runs to the sharp; the arc is tangent to both lines, with a radius.
    const width = Object.values(after.dimensions).find((d) => d.expr === '40');
    expect(width).toMatchObject({ type: 'distance', b: bottom.start });
    const r = clean(after);
    expect(r.dof).toBe(0);
    const arc = Object.values(after.entities).find((e) => e.type === 'arc');
    if (arc?.type !== 'arc') throw new Error('no arc');
    expect(round(at(after, arc.center))).toEqual([35, 5]);
    expect(constraintTypes(after).filter((t) => t === 'tangent')).toHaveLength(2);
  });

  it('refuses a radius that does not fit', () => {
    const { b, bottom, right } = rectangle();
    const before = data(b);
    const corner = cornerOf(before, id(bottom.id), id(right.id), [20, 0], [40, 10]);
    if (!corner) throw new Error('no corner');
    expect(() => fillet(before, corner, 25, '25', newId)).toThrow(/doesn't fit/);
  });

  it('finds the corner at a point where two lines end', () => {
    const { b, bottom, right } = rectangle();
    const before = data(b);
    const corner = cornerAtPoint(before, id(bottom.end));
    expect(corner && [corner.a, corner.b].sort()).toEqual([bottom.id, right.id].sort());
  });

  it('chamfers a corner with two linked distances from the sharp, still fully constrained', () => {
    const { b, bottom, right } = rectangle();
    const before = data(b);
    const corner = cornerOf(before, id(bottom.id), id(right.id), [20, 0], [40, 10]);
    if (!corner) throw new Error('no corner');
    const result = chamfer(before, corner, 4, '4', newId);
    expect(Object.keys(result.links ?? {})).toHaveLength(1);
    const after = apply(before, result);
    expect(types(after)).toEqual(['line', 'line', 'line', 'line', 'line']);
    expect(ends(after, bottom.id).map(round)).toEqual([
      [0, 0],
      [36, 0],
    ]);
    expect(clean(after).dof).toBe(0);
  });

  it('fillets two lines that cross, keeping the picked sides', () => {
    const b = new SketchBuilder();
    const h = b.line(0, 0, 20, 0);
    const v = b.line(10, -10, 10, 10);
    const before = data(b);
    const corner = cornerOf(before, id(h.id), id(v.id), [2, 0], [10, 8]);
    if (!corner) throw new Error('no corner');
    const after = apply(before, fillet(before, corner, 2, '2', newId));
    expect(ends(after, h.id).map(round)).toEqual([
      [0, 0],
      [8, 0],
    ]);
    expect(ends(after, v.id).map(round)).toEqual([
      [10, 2],
      [10, 10],
    ]);
    clean(after);
  });
});

describe('offset', () => {
  it('offsets a closed rectangle outward: parallel sides, joined corners, one linked distance', () => {
    const { b, bottom } = rectangle();
    const before = data(b);
    const chain = chainOf(before, id(bottom.id));
    expect(chain?.links).toHaveLength(4);
    expect(chain?.closed).toBe(true);
    if (!chain) return;
    // Below the bottom side is outside: the right of its direction of travel.
    const d = offsetTo(before, chain, [20, -3]);
    expect(d).toBeCloseTo(-3, 9);
    const result = offset(before, chain, d, { expr: '3', format: String }, newId);
    expect(Object.keys(result.links ?? {})).toHaveLength(3);
    const after = apply(before, result);
    const lines = Object.entries(after.entities).filter(
      ([key, e]) => e.type === 'line' && !(key in before.entities),
    );
    const xs = lines.flatMap(([key]) => ends(after, key).map((p) => round(p)));
    expect(xs).toContainEqual([-3, -3]);
    expect(xs).toContainEqual([43, 23]);
    expect(clean(after).dof).toBe(0);
  });

  it('offsets a slot inward, keeping the arcs concentric and the joints tangent', () => {
    const b = new SketchBuilder();
    const top = b.line(0, 5, 20, 5);
    const right = b.arc(20, 0, 5, -90, 90);
    const bottom = b.line(20, -5, 0, -5);
    const left = b.arc(0, 0, 5, 90, 270);
    b.constrain({ type: 'coincident', a: right.end, b: top.end });
    b.constrain({ type: 'coincident', a: bottom.start, b: right.start });
    b.constrain({ type: 'coincident', a: left.start, b: top.start });
    b.constrain({ type: 'coincident', a: bottom.end, b: left.end });
    for (const [line, arc] of [
      [top, right],
      [bottom, right],
      [top, left],
      [bottom, left],
    ] as const)
      b.constrain({ type: 'tangent', a: line.id, b: arc.id });
    const before = data(b);
    const chain = chainOf(before, id(top.id));
    expect(chain?.closed).toBe(true);
    if (!chain) return;
    const d = offsetTo(before, chain, [10, 3]);
    const after = apply(before, offset(before, chain, d, { expr: '2', format: String }, newId));
    const arcs = Object.entries(after.entities).filter(
      ([key, e]) => e.type === 'arc' && !(key in before.entities),
    );
    for (const [, arc] of arcs) {
      if (arc.type !== 'arc') continue;
      expect(Math.hypot(...sub(at(after, arc.start), at(after, arc.center)))).toBeCloseTo(3, 9);
    }
    expect(constraintTypes(after).filter((t) => t === 'tangent')).toHaveLength(8);
    clean(after);
  });

  it('offsets a circle to a concentric one with its diameter', () => {
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 10);
    const before = data(b);
    const chain = chainOf(before, id(c.id));
    if (!chain) throw new Error('no chain');
    const d = offsetTo(before, chain, [12, 0]);
    expect(d).toBeCloseTo(-2, 9);
    const after = apply(before, offset(before, chain, d, { expr: '2', format: String }, newId));
    expect(Object.values(after.dimensions)).toEqual([
      expect.objectContaining({ type: 'diameter', expr: '24' }),
    ]);
    clean(after);
  });

  it('stops a chain where three curves meet', () => {
    const b = new SketchBuilder();
    const a = b.line(0, 0, 10, 0);
    const c = b.line(10, 0, 20, 0);
    const t = b.line(10, 0, 10, 10);
    b.constrain({ type: 'coincident', a: a.end, b: c.start });
    b.constrain({ type: 'coincident', a: a.end, b: t.start });
    expect(chainOf(data(b), id(a.id))?.links.map((l) => l.id)).toEqual([a.id]);
  });

  /** A 40 × 20 outline with 4 mm round corners, as a face projects it: no joints, all projected. */
  function projectedOutline(round: boolean) {
    const b = new SketchBuilder();
    const r = round ? 4 : 0;
    const curves = round
      ? [
          b.line(r, 0, 40 - r, 0),
          b.arc(40 - r, r, r, -90, 0),
          b.line(40, r, 40, 20 - r),
          b.arc(40 - r, 20 - r, r, 0, 90),
          b.line(40 - r, 20, r, 20),
          b.arc(r, 20 - r, r, 90, 180),
          b.line(0, 20 - r, 0, r),
          b.arc(r, r, r, 180, 270),
        ]
      : [b.line(0, 0, 40, 0), b.line(40, 0, 40, 20), b.line(40, 20, 0, 20), b.line(0, 20, 0, 0)];
    const projected = {
      ...data(b),
      projections: {
        proj1: {
          ref: { kind: 'face', id: 'extrude:E:cap:end' },
          curves: Object.fromEntries(curves.map((c, i) => [`e${i}`, c.id])),
        },
      },
    } as SketchData;
    return { curves, projected };
  }

  it('follows a projected face outline: ends in one place are a joint (P3-17)', () => {
    const { curves, projected } = projectedOutline(false);
    expect(projected.projections).toBeDefined();
    const first = curves[0];
    if (!first) throw new Error('no curve');
    const chain = chainOf(projected, id(first.id));
    expect(chain?.links).toHaveLength(4);
    expect(chain?.closed).toBe(true);
    // The same picked from any side gives the same four curves.
    const other = chainOf(projected, id((curves[2] as { id: string }).id));
    expect(new Set(other?.links.map((l) => l.id))).toEqual(new Set(chain?.links.map((l) => l.id)));
    if (!chain) return;
    const d = offsetTo(projected, chain, [20, -3]);
    expect(d).toBeCloseTo(-3, 9);
    const after = apply(
      projected,
      offset(projected, chain, d, { expr: '3', format: String }, newId),
    );
    const made = Object.entries(after.entities).filter(
      ([key, e]) => e.type === 'line' && !(key in projected.entities),
    );
    expect(made).toHaveLength(4);
    const xs = made.flatMap(([key]) => ends(after, key).map((p) => round(p)));
    expect(xs).toContainEqual([-3, -3]);
    expect(xs).toContainEqual([43, 23]);
    expect(clean(after).dof).toBe(0);
  });

  it('follows a projected outline with round corners, arcs concentric', () => {
    const { curves, projected } = projectedOutline(true);
    const first = curves[0];
    if (!first) throw new Error('no curve');
    const chain = chainOf(projected, id(first.id));
    expect(chain?.links).toHaveLength(8);
    expect(chain?.closed).toBe(true);
    if (!chain) return;
    const d = offsetTo(projected, chain, [20, 3]);
    expect(d).toBeGreaterThan(0);
    const after = apply(
      projected,
      offset(projected, chain, d, { expr: '3', format: String }, newId),
    );
    const arcs = Object.entries(after.entities).filter(
      ([key, e]) => e.type === 'arc' && !(key in projected.entities),
    );
    expect(arcs).toHaveLength(4);
    for (const [, arc] of arcs) {
      if (arc.type !== 'arc') continue;
      expect(Math.hypot(...sub(at(after, arc.start), at(after, arc.center)))).toBeCloseTo(1, 9);
    }
    expect(clean(after).dof).toBe(0);
  });

  it('does not join sketched curves that merely end in one place', () => {
    const b = new SketchBuilder();
    const a = b.line(0, 0, 10, 0);
    b.line(10, 0, 10, 10);
    expect(chainOf(data(b), id(a.id))?.links).toHaveLength(1);
  });

  it('refuses to shrink an arc past nothing', () => {
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 2);
    const before = data(b);
    const chain = chainOf(before, id(c.id));
    if (!chain) throw new Error('no chain');
    expect(() => offset(before, chain, 3, { expr: '3', format: String }, newId)).toThrow(/further/);
  });
});

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

describe('mirror, copy, patterns and scale', () => {
  it('mirrors curves with symmetry constraints, joining points that lie on the mirror line', () => {
    const b = new SketchBuilder();
    const axis = b.line(0, -20, 0, 20, true);
    b.constrain({ type: 'fix', entity: axis.start });
    b.constrain({ type: 'fix', entity: axis.end });
    const l = b.line(0, 10, 10, 0);
    const a = b.arc(15, 0, 5, 0, 90);
    const c = b.circle(10, 10, 2);
    const before = data(b);
    const result = mirror(before, [id(l.id), id(a.id), id(c.id), id(axis.id)], id(axis.id), newId);
    expect(result.auto).toHaveLength(1);
    expect(Object.keys(result.constraints ?? {})).toHaveLength(5);
    const after = apply(before, result);
    expect(types(after)).toEqual(['arc', 'arc', 'circle', 'circle', 'line', 'line', 'line']);
    const copies = Object.entries(after.entities).filter(([key]) => !(key in before.entities));
    const arcCopy = copies.find(([, e]) => e.type === 'arc')?.[1];
    if (arcCopy?.type !== 'arc') throw new Error('no arc copy');
    // A mirrored arc runs the other way: its start is the image of the original's end.
    expect(round(at(after, arcCopy.start))).toEqual([-15, 5]);
    expect(round(at(after, arcCopy.end))).toEqual([-20, 0]);
    const before2 = solve(before).dof;
    const r = clean(after);
    // The copies follow; the point on the axis is now held there (one freedom less).
    expect(r.dof).toBe(before2 - 1);
  });

  it("carries a spline's mode and rho over to its copy (P4-05)", () => {
    const b = new SketchBuilder();
    const axis = b.line(0, -20, 0, 20, true);
    b.constrain({ type: 'fix', entity: axis.start });
    b.constrain({ type: 'fix', entity: axis.end });
    const conic = b.spline(
      [
        [0, 10],
        [10, 16],
        [20, 10],
      ],
      { mode: 'conic', rho: 0.3 },
    );
    const poles = b.spline(
      [
        [0, 4],
        [8, 8],
        [16, 2],
        [20, 5],
      ],
      { mode: 'control' },
    );
    const before = data(b);
    for (const objects of [[id(conic.id)], [id(poles.id)]]) {
      const after = apply(before, copy(before, [...objects, id(axis.id)], [40, 0], newId));
      const copies = Object.entries(after.entities).filter(
        ([key, e]) => e.type === 'spline' && !(key in before.entities),
      );
      expect(copies).toHaveLength(1);
      const [copyEntity] = copies.map(([, e]) => e);
      expect(copyEntity).toMatchObject(
        conic.id === objects[0] ? { mode: 'conic', rho: 0.3 } : { mode: 'control' },
      );
      expect((copyEntity as { points: string[] }).points).toHaveLength(
        conic.id === objects[0] ? 3 : 4,
      );
    }
    // Mirroring copies the entity the same way (a conic is affine-invariant).
    const mirrored = apply(before, mirror(before, [id(conic.id), id(axis.id)], id(axis.id), newId));
    const [mirroredConic] = Object.entries(mirrored.entities)
      .filter(([key, e]) => e.type === 'spline' && !(key in before.entities))
      .map(([, e]) => e);
    expect(mirroredConic).toMatchObject({ mode: 'conic', rho: 0.3 });
  });

  it('copies geometry with its constraints and dimensions', () => {
    const { b, bottom, right, top, left } = rectangle();
    const before = data(b);
    const ids = [bottom, right, top, left].map((l) => id(l.id));
    const after = apply(before, copy(before, ids, [100, 0], newId));
    expect(types(after)).toHaveLength(8);
    expect(Object.keys(after.constraints)).toHaveLength(2 * Object.keys(before.constraints).length);
    expect(Object.values(after.dimensions).map((d) => d.expr)).toEqual(['40', '20', '40', '20']);
    // The copy's fixed corner is fixed where the copy is.
    expect(clean(after).dof).toBe(0);
  });

  it('patterns take the original dimensions’ parameters', () => {
    const b = new SketchBuilder();
    const c = b.circle(0, 0, 3);
    b.constrain({ type: 'fix', entity: c.center });
    b.dimension({ type: 'diameter', curve: c.id }, 6);
    const before = data(b);
    const named = {
      ...before,
      dimensions: Object.fromEntries(
        Object.entries(before.dimensions).map(([k, d]) => [k, { ...d, paramName: 'd1' }]),
      ),
    } as SketchData;
    const after = apply(named, rectangularPattern(named, [id(c.id)], 3, 2, [10, 8], newId));
    expect(types(after)).toHaveLength(6);
    const exprs = Object.values(after.dimensions).map((d) => d.expr);
    expect(exprs.filter((e) => e === 'd1')).toHaveLength(5);
    const centers = Object.values(after.entities)
      .filter((e) => e.type === 'circle')
      .map((e) => (e.type === 'circle' ? round(at(after, e.center)) : [0, 0]));
    expect(centers).toContainEqual([20, 8]);
  });

  it('a circular pattern turns copies and leaves orientation constraints behind', () => {
    const b = new SketchBuilder();
    const l = b.line(10, 0, 20, 0);
    b.constrain({ type: 'horizontal', a: l.id });
    b.dimension({ type: 'distance', orientation: 'aligned', a: l.id }, 10);
    const before = data(b);
    const after = apply(before, circularPattern(before, [id(l.id)], [0, 0], 4, 2 * Math.PI, newId));
    expect(types(after)).toHaveLength(4);
    expect(constraintTypes(after)).toEqual(['horizontal']);
    expect(Object.keys(after.dimensions)).toHaveLength(4);
    const up = Object.entries(after.entities).find(
      ([key, e]) => e.type === 'line' && key !== l.id && round(ends(after, key)[0])[0] === 0,
    );
    expect(up && ends(after, up[0]).map(round)).toEqual([
      [0, 10],
      [0, 20],
    ]);
  });

  it('scales points, radii and the dimensions wholly on the objects', () => {
    const b = new SketchBuilder();
    const c = b.circle(10, 0, 3);
    b.dimension({ type: 'diameter', curve: c.id }, 6);
    const before = data(b);
    const { result, moved } = scale(before, [id(c.id)], [0, 0], 2, newId);
    expect(moved).toEqual([c.center]);
    const after = apply(before, result);
    expect(at(after, c.center)).toEqual([20, 0]);
    expect(after.entities[id(c.id)]).toMatchObject({ radius: 6 });
    expect(Object.values(after.dimensions)[0]?.expr).toBe('12');
    expect(scaleExpression('20 mm', 1.5)).toBe('30 mm');
    expect(scaleExpression('d3 + 1', 2)).toBe('(d3 + 1) * 2');
  });
});
