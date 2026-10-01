import { dimensionUnit, type SketchData, type SketchEntity } from '@extrudo/core';
import type { DimensionValues } from './mapping';
import type { SketchSolution, SketchSolver, SolveResult } from './solver';

/** At most this many solves for one change... */
export const MAX_STEPS = 100;
/**
 * ...and at most about this many entities solved in all, so a big sketch
 * takes fewer steps (a solve costs about linearly in its entities).
 */
const STEP_BUDGET = 4000;
/**
 * Each step moves geometry or a length by at most this fraction of the
 * sketch's smallest size. A line held at distance d from an edge lands on the
 * far side once the edge moves more than d in one solve (the far solution is
 * then the nearer one), so a step must stay well below that.
 */
const STEP_FRACTION = 0.5;
/** Each step turns an angle dimension by at most this many degrees. */
const STEP_DEGREES = 30;

type Entities = Record<string, SketchEntity>;

/**
 * The smallest size in a sketch: the shortest drawn line, the smallest
 * circle and the smallest length a dimension holds. A change bigger than
 * about twice it can land a solve on the other side of a line.
 */
function smallestSize(data: SketchData, values: DimensionValues): number {
  const entities = data.entities as Entities;
  let size = Number.POSITIVE_INFINITY;
  const at = (id: string) => {
    const p = entities[id];
    return p?.type === 'point' ? p : undefined;
  };
  for (const e of Object.values(entities)) {
    if (e.type === 'line') {
      const a = at(e.start);
      const b = at(e.end);
      if (a && b) size = Math.min(size, Math.hypot(b.x - a.x, b.y - a.y) || size);
    } else if (e.type === 'circle' && e.radius > 0) size = Math.min(size, e.radius);
  }
  for (const [id, value] of Object.entries(values)) {
    const d = data.dimensions[id as keyof SketchData['dimensions']];
    if (d && dimensionUnit(d) === 'length' && Math.abs(value) > 0) {
      size = Math.min(size, Math.abs(value));
    }
  }
  return size;
}

/**
 * How many steps take `from` to `to`: points and radii that `to` moved (the
 * projected curves a sync moved, which the solver holds fixed) and dimension
 * values that changed, each step a bounded part of the sketch's smallest size.
 */
export function stepsBetween(
  from: SketchData,
  to: SketchData,
  fromValues: DimensionValues,
  toValues: DimensionValues,
): number {
  const size = Math.min(smallestSize(from, fromValues), smallestSize(to, toValues));
  if (!Number.isFinite(size) || size <= 0) return 1;
  const before = from.entities as Entities;
  let ratio = 0;
  for (const [id, e] of Object.entries(to.entities as Entities)) {
    const old = before[id];
    if (e.type === 'point' && old?.type === 'point') {
      ratio = Math.max(ratio, Math.hypot(e.x - old.x, e.y - old.y) / size);
    } else if (e.type === 'circle' && old?.type === 'circle') {
      ratio = Math.max(ratio, Math.abs(e.radius - old.radius) / size);
    }
  }
  let angle = 0;
  for (const [id, value] of Object.entries(toValues)) {
    const was = fromValues[id];
    const d = to.dimensions[id as keyof SketchData['dimensions']];
    if (was === undefined || !d) continue;
    if (dimensionUnit(d) === 'angle') angle = Math.max(angle, Math.abs(value - was));
    else ratio = Math.max(ratio, Math.abs(value - was) / size);
  }
  const steps = Math.max(ratio / STEP_FRACTION, angle / STEP_DEGREES);
  const cap = Math.max(8, Math.floor(STEP_BUDGET / Math.max(1, Object.keys(to.entities).length)));
  return Math.min(MAX_STEPS, cap, Math.max(1, Math.ceil(steps)));
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** `solver.ts`'s `applySolution`, repeated here so this file stays free of planegcs's JS. */
function applied(data: SketchData, solution: SketchSolution): SketchData {
  const entities: Entities = { ...(data.entities as Entities) };
  for (const [id, p] of Object.entries(solution.points)) {
    const e = entities[id];
    if (e?.type === 'point') entities[id] = { ...e, x: p.x, y: p.y };
  }
  for (const [id, radius] of Object.entries(solution.radii)) {
    const e = entities[id];
    if (e?.type === 'circle') entities[id] = { ...e, radius };
  }
  return { ...data, entities } as SketchData;
}

/**
 * Solves `to` (with `toValues`) starting from the solved `from` state, in
 * steps when the change is large (P3-13). planegcs finds the solution
 * nearest to where the geometry starts, and dimensions are unsigned: a line
 * held 3 mm from an edge that moves 30 mm lands 3 mm on the far side of it,
 * turning a box's inside out. Moving the fixed geometry (projected curves)
 * and the dimension values a part of the way at a time lets every solve
 * start near its answer, so the geometry follows as a drag would.
 *
 * `to` is the sketch as it is now (its fixed geometry where it must end up,
 * its free geometry where the last solve left it); `from` is that last
 * solved state. The result is the solve of `to`, as `solver.solve(to,
 * toValues)` would return it, positions included for every free point.
 */
export function solveGradually(
  solver: SketchSolver,
  from: SketchData,
  to: SketchData,
  fromValues: DimensionValues,
  toValues: DimensionValues,
): SolveResult {
  const steps = stepsBetween(from, to, fromValues, toValues);
  if (steps <= 1) return solver.solve(to, toValues);
  const before = from.entities as Entities;
  const target = to.entities as Entities;
  // What moves between the two: fixed points and circles the caller moved.
  const moved = Object.entries(target).filter(([id, e]) => {
    const old = before[id];
    if (e.type === 'point' && old?.type === 'point') return e.x !== old.x || e.y !== old.y;
    if (e.type === 'circle' && old?.type === 'circle') return e.radius !== old.radius;
    return false;
  });
  let current = to;
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const entities: Entities = { ...(current.entities as Entities) };
    for (const [id, e] of moved) {
      const old = before[id] as SketchEntity;
      if (e.type === 'point' && old.type === 'point') {
        entities[id] = { ...e, x: lerp(old.x, e.x, t), y: lerp(old.y, e.y, t) };
      } else if (e.type === 'circle' && old.type === 'circle') {
        entities[id] = { ...e, radius: lerp(old.radius, e.radius, t) };
      }
    }
    const values: Record<string, number> = {};
    for (const [id, value] of Object.entries(toValues)) {
      const was = fromValues[id];
      values[id] = was === undefined ? value : lerp(was, value, t);
    }
    const partial = { ...current, entities } as SketchData;
    const result = solver.solve(partial, values);
    // A step that doesn't converge keeps the geometry where it was; the next one tries again.
    if (result.ok) current = applied(partial, result.solution);
  }
  // The last step is `to` itself, with the free geometry where the steps took it.
  const fixed = new Set(moved.map(([id]) => id));
  const entities: Entities = { ...target };
  for (const [id, e] of Object.entries(current.entities as Entities)) {
    if (id in target && !fixed.has(id)) entities[id] = e;
  }
  return solver.solve({ ...to, entities } as SketchData, toValues);
}
