// SolveSpace's solver (`slvs` on npm, GPL-3.0) on the same sketches as the
// planegcs benchmark, to see whether a sparse solver scales where planegcs's
// dense one doesn't. Same cells (rectangle, hole, slot), same layouts; the
// dimensions are SolveSpace-style (point-to-line distances instead of
// planegcs's coordinate differences), with the same unknowns and coupling.
//
// The published build has no setParamValue, so a drag step rebuilds the
// sketch with the dragged point at the target and re-solves (SolveSpace's own
// "dragged" constraint keeps it there).
// biome-ignore-all lint/suspicious/noExplicitAny: slvs ships no types
import type { Layout } from './sketches.ts';

type S = any;
const W = 50;
const H = 30;
const GAP = 20;
const G = 2; // the sketch's group; group 1 holds the workplane

export interface SlvsSketch {
  entities: number;
  /** Top-right corner of the last rectangle (free when freeLastHeight). */
  dragPoint: any;
  params: number;
}

/** Builds the sketch into the (global) slvs system. */
export function buildSlvs(
  s: S,
  entities: number,
  layout: Layout,
  options: { freeLastHeight?: boolean; drag?: { x: number; y: number }; conflict?: boolean } = {},
): SlvsSketch {
  s.clearSketch();
  const wp = s.addBase2D(1);
  const normal = s.addNormal3D(1, 1, 0, 0, 0); // arcs and circles take the plane's 3D normal
  const cells = Math.max(1, Math.round(entities / 9));
  let params = 0;
  const pt = (x: number, y: number) => {
    params += 2;
    return s.addPoint2D(G, x, y, wp);
  };
  const line = (a: any, b: any) => s.addLine2D(G, a, b, wp);
  const joined = (p: any, x: number, y: number) => {
    const q = pt(x, y);
    s.coincident(G, p, q, wp);
    return q;
  };
  const origin = s.addPoint2D(1, 0, 0, wp); // fixed: group 1 isn't solved
  const xAxis = s.addLine2D(1, origin, s.addPoint2D(1, 1, 0, wp), wp);
  const yAxis = s.addLine2D(1, origin, s.addPoint2D(1, 0, 1, wp), wp);
  let previousCorner: any;
  let dragPoint: any;
  let firstLeft: any;
  for (let cell = 0; cell < cells; cell++) {
    const x0 = cell * (W + GAP);
    const last = cell === cells - 1;
    const a = pt(x0, 0);
    const b = pt(x0 + W, 0);
    const c = last && options.drag ? pt(options.drag.x, options.drag.y) : pt(x0 + W, H);
    const d = pt(x0, H);
    const bottom = line(a, b);
    const right = line(joined(b, x0 + W, 0), c);
    const top = line(joined(c, x0 + W, H), d);
    const left = line(joined(d, x0, H), joined(a, x0, 0));
    if (cell === 0) firstLeft = [d, a];
    s.horizontal(G, bottom, wp, s.E_NONE);
    s.horizontal(G, top, wp, s.E_NONE);
    s.vertical(G, right, wp, s.E_NONE);
    s.vertical(G, left, wp, s.E_NONE);
    s.distance(G, a, b, W, wp);
    if (last && options.freeLastHeight) {
      dragPoint = c;
      if (options.drag) s.dragged(G, c, wp);
    } else s.distance(G, b, c, H, wp);
    if (previousCorner && layout === 'chained') {
      s.horizontal(G, previousCorner, wp, a);
      s.distance(G, previousCorner, a, W + GAP, wp);
    } else {
      s.distance(G, a, yAxis, x0, wp);
      s.distance(G, a, xAxis, 0, wp);
    }
    previousCorner = a;

    // Hole Ø10, 15 from the left and bottom sides.
    const hc = pt(x0 + 15, 15);
    params += 1;
    const hole = s.addCircle(G, normal, hc, s.addDistance(G, 5, wp), wp);
    s.diameter(G, hole, 10);
    s.distance(G, hc, left, 15, wp);
    s.distance(G, hc, bottom, 15, wp);

    // Slot: arcs r = 4 at 30 and 42 from the left side, 15 up.
    const r = 4;
    const c1 = pt(x0 + 30, 15);
    const c2 = pt(x0 + 42, 15);
    // (This build's entity objects don't expose `point`, so keep the endpoints.)
    const [s1, e1] = [pt(x0 + 30, 15 + r), pt(x0 + 30, 15 - r)];
    const [s2, e2] = [pt(x0 + 42, 15 - r), pt(x0 + 42, 15 + r)];
    const arc1 = s.addArc(G, normal, c1, s1, e1, wp);
    const arc2 = s.addArc(G, normal, c2, s2, e2, wp);
    const slotBottom = line(joined(e1, x0 + 30, 15 - r), joined(s2, x0 + 42, 15 - r));
    const slotTop = line(joined(e2, x0 + 42, 15 + r), joined(s1, x0 + 30, 15 + r));
    // Tangency: this build's tangent() aborts ("Cannot find handle"), so use the
    // equivalent single equation: the radius to the joint is perpendicular to
    // the line. (The radius lines share existing points: no new unknowns.)
    for (const [centre, joint, l] of [
      [c1, e1, slotBottom],
      [c2, s2, slotBottom],
      [c2, e2, slotTop],
      [c1, s1, slotTop],
    ]) {
      s.perpendicular(G, line(centre, joint), l, wp, false);
    }
    s.horizontal(G, slotBottom, wp, s.E_NONE);
    s.equal(G, arc1, arc2, wp);
    s.diameter(G, arc1, 2 * r);
    s.distance(G, c1, c2, 12, wp);
    s.distance(G, c1, left, 30, wp);
    s.distance(G, c1, bottom, 15, wp);
  }
  if (options.conflict) s.distance(G, firstLeft[0], firstLeft[1], 35, wp);
  return { entities: cells * 9, dragPoint, params };
}

const time = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

export function benchSlvs(s: S, entities: number, layout: Layout) {
  let result: any;
  let sketch: SlvsSketch = { entities: 0, dragPoint: undefined, params: 0 };
  const first = time(() => {
    sketch = buildSlvs(s, entities, layout);
    result = s.solveSketch(G, false);
  });
  const firstResult = { result: result.result, dof: result.dof };
  const reps = Math.max(3, Math.min(50, Math.round(2000 / Math.max(first, 0.01))));
  const drag: number[] = [];
  for (let i = 0; i < reps; i++) {
    drag.push(
      time(() => {
        buildSlvs(s, entities, layout, { freeLastHeight: true, drag: { x: 0, y: 30 + 10 * Math.sin(i / 10) } });
        result = s.solveSketch(G, false);
      }),
    );
  }
  const dragResult = { result: result.result, dof: result.dof };
  let conflict: any;
  const conflictMs = time(() => {
    buildSlvs(s, entities, layout, { conflict: true });
    conflict = s.solveSketch(G, true);
  });
  return {
    entities: sketch.entities,
    layout,
    unknowns: sketch.params,
    first,
    firstResult,
    dragRebuild: median(drag),
    dragResult,
    conflict: { ms: conflictMs, result: conflict.result, bad: conflict.bad },
  };
}
