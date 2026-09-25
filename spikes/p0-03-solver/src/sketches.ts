// Generates realistic, fully constrained sketches for the solver benchmark.
//
// One "cell" is what a user draws for a simple plate feature: a rectangle
// (4 lines), a hole (circle) and a slot (2 lines + 2 arcs, tangent at the joints), each
// dimensioned and positioned relative to the rectangle's corner. How the cells
// are positioned is the `layout` option.
//
// Entity counts are curves (lines, arcs, circles): 9 per cell. Points are not
// counted, matching how a user counts sketch entities.
//
// Two ways to join curves:
// - 'coincident': every curve has its own endpoints, joined by coincident
//   constraints (how FreeCAD and Fusion store sketches).
// - 'shared': joined curves reference the same point, so the coincident
//   constraints disappear (an adapter could merge coincident points first).
import type { SketchParam, SketchPrimitive } from '@salusoft89/planegcs';

export type JoinMode = 'coincident' | 'shared';

/**
 * - 'chained': cell i is dimensioned from cell i−1, so the sketch is one coupled
 *   system (worst case).
 * - 'anchored': every cell is dimensioned from the fixed origin. Constraints to
 *   fixed geometry don't couple unknowns, so the solver splits the sketch into
 *   one independent component per cell (the usual case in real sketches).
 */
export type Layout = 'chained' | 'anchored';

export interface GeneratedSketch {
  primitives: (SketchPrimitive | SketchParam)[];
  entities: number;
  cells: number;
  /** The corner point of each cell's rectangle (drag target candidates). */
  corners: string[];
  /** A free corner to drag in an under-constrained variant. */
  dragPoint: string;
}

export const CELL_ENTITIES = 9;
const W = 50;
const H = 30;
const GAP = 20;

/** Deterministic PRNG so every run perturbs the same way. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface GenerateOptions {
  entities: number;
  join?: JoinMode;
  layout?: Layout;
  /** Random offset added to every point, in mm, as if a dimension just changed. */
  noise?: number;
  seed?: number;
  /**
   * Leave the last cell's rectangle height undimensioned, so one corner can be
   * dragged (a fully constrained sketch can't move).
   */
  freeLastHeight?: boolean;
}

export function generate(options: GenerateOptions): GeneratedSketch {
  const join = options.join ?? 'coincident';
  const layout = options.layout ?? 'chained';
  const noise = options.noise ?? 0;
  const random = rng(options.seed ?? 1);
  const jitter = () => (random() - 0.5) * 2 * noise;
  const cells = Math.max(1, Math.round(options.entities / CELL_ENTITIES));
  const out: (SketchPrimitive | SketchParam)[] = [{ type: 'param', name: 'W', value: W }];
  const corners: string[] = [];
  let n = 0;
  const id = (prefix: string) => `${prefix}${n++}`;
  const point = (x: number, y: number) => {
    const p = id('p');
    out.push({ id: p, type: 'point', x: x + jitter(), y: y + jitter(), fixed: false });
    return p;
  };
  const line = (p1: string, p2: string) => {
    const l = id('l');
    out.push({ id: l, type: 'line', p1_id: p1, p2_id: p2 });
    return l;
  };
  const push = (c: object) => out.push({ id: id('c'), ...c } as SketchPrimitive);
  /** Endpoint for a joined curve: reuse `shared` in shared mode, else a new point + coincident. */
  const joint = (shared: string, x: number, y: number) => {
    if (join === 'shared') return shared;
    const p = point(x, y);
    push({ type: 'p2p_coincident', p1_id: shared, p2_id: p });
    return p;
  };
  /** Horizontal / vertical offset dimensions: `to − from = d` (planegcs: param2 − param1). */
  const dx = (from: string, to: string, d: number | string) =>
    push({ type: 'difference', param1: { o_id: from, prop: 'x' }, param2: { o_id: to, prop: 'x' }, difference: d });
  const dy = (from: string, to: string, d: number | string) =>
    push({ type: 'difference', param1: { o_id: from, prop: 'y' }, param2: { o_id: to, prop: 'y' }, difference: d });

  let previousCorner: string | undefined;
  let dragPoint = '';
  for (let cell = 0; cell < cells; cell++) {
    const x0 = cell * (W + GAP);
    // Rectangle, counter-clockwise from the bottom-left corner.
    const a = point(x0, 0);
    const b = point(x0 + W, 0);
    const c = point(x0 + W, H);
    const d = point(x0, H);
    const bottom = line(a, b);
    const right = line(joint(b, x0 + W, 0), c);
    const top = line(joint(c, x0 + W, H), d);
    const left = line(joint(d, x0, H), joint(a, x0, 0));
    push({ type: 'horizontal_l', l_id: bottom });
    push({ type: 'horizontal_l', l_id: top });
    push({ type: 'vertical_l', l_id: right });
    push({ type: 'vertical_l', l_id: left });
    push({ type: 'p2p_distance', p1_id: a, p2_id: b, distance: 'W' });
    const lastCell = cell === cells - 1;
    if (lastCell && options.freeLastHeight) dragPoint = c;
    else push({ type: 'p2p_distance', p1_id: b, p2_id: c, distance: H });
    if (previousCorner && layout === 'chained') {
      dx(previousCorner, a, W + GAP);
      dy(previousCorner, a, 0);
    } else {
      push({ type: 'coordinate_x', p_id: a, x: x0 });
      push({ type: 'coordinate_y', p_id: a, y: 0 });
    }
    corners.push(a);
    previousCorner = a;

    // Hole: Ø10 at (15, 15) from the corner.
    const hc = point(x0 + 15, 15);
    out.push({ id: id('h'), type: 'circle', c_id: hc, radius: 5 + jitter() / 4 });
    const hole = out[out.length - 1] as { id: string };
    push({ type: 'circle_diameter', c_id: hole.id, diameter: 10 });
    dx(a, hc, 15);
    dy(a, hc, 15);

    // Slot: arc centres at (30, 15) and (42, 15), r = 4, bottom line then top line.
    const r = 4;
    const c1 = point(x0 + 30, 15);
    const c2 = point(x0 + 42, 15);
    const s1 = point(x0 + 30, 15 + r); // arc 1 runs from its top (π/2) to its bottom (3π/2)
    const e1 = point(x0 + 30, 15 - r);
    const s2 = point(x0 + 42, 15 - r); // arc 2 runs from its bottom (−π/2) to its top (π/2)
    const e2 = point(x0 + 42, 15 + r);
    const arc1 = id('a');
    out.push({ id: arc1, type: 'arc', c_id: c1, radius: r, start_angle: Math.PI / 2, end_angle: (3 * Math.PI) / 2, start_id: s1, end_id: e1 });
    push({ type: 'arc_rules', a_id: arc1 });
    const arc2 = id('a');
    out.push({ id: arc2, type: 'arc', c_id: c2, radius: r, start_angle: -Math.PI / 2, end_angle: Math.PI / 2, start_id: s2, end_id: e2 });
    push({ type: 'arc_rules', a_id: arc2 });
    const slotBottom = line(joint(e1, x0 + 30, 15 - r), joint(s2, x0 + 42, 15 - r));
    const slotTop = line(joint(e2, x0 + 42, 15 + r), joint(s1, x0 + 30, 15 + r));
    // Endpoint tangency as FreeCAD does it: the angle between the two curves at
    // the joint is 0. (tangent_la + coincident endpoints is degenerate at the
    // solution, so the solver then reports false redundancies and DOF.)
    for (const [crv1, crv2, p] of [
      [arc1, slotBottom, e1],
      [arc2, slotBottom, s2],
      [arc2, slotTop, e2],
      [arc1, slotTop, s1],
    ] as const) {
      push({ type: 'angle_via_point', crv1_id: crv1, crv2_id: crv2, p_id: p, angle: 0 });
    }
    push({ type: 'horizontal_l', l_id: slotBottom });
    push({ type: 'equal_radius_aa', a1_id: arc1, a2_id: arc2 });
    push({ type: 'arc_radius', a_id: arc1, radius: r });
    push({ type: 'p2p_distance', p1_id: c1, p2_id: c2, distance: 12 });
    dx(a, c1, 30);
    dy(a, c1, 15);
  }
  return { primitives: out, entities: cells * CELL_ENTITIES, cells, corners, dragPoint };
}
