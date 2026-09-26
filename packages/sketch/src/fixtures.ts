/**
 * Sketches for the solver's tests and benchmark (P1-03): a small builder and
 * two generators. Not part of the package's public entry.
 *
 * - `plate()` ports the P0-03 spike's cells: a rectangle, a hole and a slot
 *   with tangent arcs, all dimensioned; 9 curves per cell. `anchored` places
 *   every cell from a fixed origin point (independent components),
 *   `chained` each cell from the previous one (one coupled component).
 * - `gear()` is one closed loop of 4 curves per tooth (tip arc, flank, root
 *   arc, flank), fully constrained: the worst realistic single component.
 */
import type { SketchConstraint, SketchData, SketchDimension, SketchEntity } from '@extrudo/core';

type Constraint = SketchConstraint;
type DimensionShape = SketchDimension extends infer D
  ? D extends SketchDimension
    ? Omit<D, 'expr' | 'driven' | 'paramName'>
    : never
  : never;

export class SketchBuilder {
  readonly entities: Record<string, SketchEntity> = {};
  readonly constraints: Record<string, Constraint> = {};
  readonly dimensions: Record<string, SketchDimension> = {};
  readonly values: Record<string, number> = {};
  #next = 0;
  readonly #noise: () => number;

  /** `noise`: a random offset (mm) added to every point, as if a dimension just changed. */
  constructor(options: { noise?: number; seed?: number } = {}) {
    const random = rng(options.seed ?? 1);
    const noise = options.noise ?? 0;
    this.#noise = () => (random() - 0.5) * 2 * noise;
  }

  id(prefix: string): string {
    return `${prefix}${this.#next++}`;
  }

  point(x: number, y: number): string {
    const id = this.id('p');
    this.entities[id] = { type: 'point', x: x + this.#noise(), y: y + this.#noise() };
    return id;
  }

  line(x1: number, y1: number, x2: number, y2: number, construction = false) {
    const start = this.point(x1, y1);
    const end = this.point(x2, y2);
    const id = this.id('l');
    this.entities[id] = { type: 'line', start: start as never, end: end as never, construction };
    return { id, start, end };
  }

  circle(cx: number, cy: number, radius: number) {
    const center = this.point(cx, cy);
    const id = this.id('c');
    this.entities[id] = { type: 'circle', center: center as never, radius, construction: false };
    return { id, center };
  }

  /** Counter-clockwise from `from` to `to` (degrees). */
  arc(cx: number, cy: number, radius: number, from: number, to: number) {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const center = this.point(cx, cy);
    const start = this.point(cx + radius * Math.cos(rad(from)), cy + radius * Math.sin(rad(from)));
    const end = this.point(cx + radius * Math.cos(rad(to)), cy + radius * Math.sin(rad(to)));
    const id = this.id('a');
    this.entities[id] = {
      type: 'arc',
      center: center as never,
      start: start as never,
      end: end as never,
      construction: false,
    };
    return { id, center, start, end };
  }

  /** Semi-axes `a` (major) and `b`, the major axis at `rotation` degrees; the minor end counter-clockwise from it. */
  ellipse(cx: number, cy: number, a: number, b: number, rotation = 0) {
    const t = (rotation * Math.PI) / 180;
    const center = this.point(cx, cy);
    const major = this.point(cx + a * Math.cos(t), cy + a * Math.sin(t));
    const minor = this.point(cx - b * Math.sin(t), cy + b * Math.cos(t));
    const id = this.id('e');
    this.entities[id] = {
      type: 'ellipse',
      center: center as never,
      major: major as never,
      minor: minor as never,
      construction: false,
    };
    return { id, center, major, minor };
  }

  /** A fit-point spline through `points` ([x, y] pairs). */
  spline(points: [number, number][]) {
    const ids = points.map(([x, y]) => this.point(x, y));
    const id = this.id('s');
    this.entities[id] = { type: 'spline', points: ids as never, construction: false };
    return { id, points: ids };
  }

  constrain(constraint: { type: Constraint['type'] } & Record<string, unknown>): string {
    const id = this.id('k');
    this.constraints[id] = constraint as Constraint;
    return id;
  }

  /** A driving dimension; `value` in mm or degrees. */
  dimension(
    shape: DimensionShape | ({ type: SketchDimension['type'] } & Record<string, unknown>),
    value: number,
  ): string {
    const id = this.id('d');
    this.dimensions[id] = { ...shape, expr: String(value), driven: false } as SketchDimension;
    this.values[id] = value;
    return id;
  }

  get sketch(): SketchData {
    return {
      entities: this.entities,
      constraints: this.constraints,
      dimensions: this.dimensions,
    } as unknown as SketchData;
  }
}

/** Deterministic PRNG, so every run perturbs the same way. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface PlateOptions {
  /** Curves (lines, arcs, circles); rounded to whole cells of 9. */
  entities: number;
  layout: 'anchored' | 'chained';
  noise?: number;
  /** Leave the last cell's rectangle height free, so `dragPoint` can move. */
  freeLastHeight?: boolean;
}

export interface Plate {
  builder: SketchBuilder;
  entities: number;
  cells: number;
  /** The last cell's top-right corner: free to move with `freeLastHeight`. */
  dragPoint: string;
}

export const CELL_ENTITIES = 9;
const W = 50;
const H = 30;
const GAP = 20;

export function plate(options: PlateOptions): Plate {
  const b = new SketchBuilder({ noise: options.noise ?? 0 });
  const cells = Math.max(1, Math.round(options.entities / CELL_ENTITIES));
  const origin = b.point(0, 0);
  b.constrain({ type: 'fix', entity: origin });
  const join = (p: string, q: string) => b.constrain({ type: 'coincident', a: p, b: q });
  const dx = (from: string, to: string, d: number) =>
    b.dimension({ type: 'distance', orientation: 'horizontal', a: from, b: to }, d);
  const dy = (from: string, to: string, d: number) =>
    b.dimension({ type: 'distance', orientation: 'vertical', a: from, b: to }, d);

  let previous: string | undefined;
  let dragPoint = '';
  for (let cell = 0; cell < cells; cell++) {
    const x0 = cell * (W + GAP);
    // Rectangle, counter-clockwise from the bottom-left corner.
    const bottom = b.line(x0, 0, x0 + W, 0);
    const right = b.line(x0 + W, 0, x0 + W, H);
    const top = b.line(x0 + W, H, x0, H);
    const left = b.line(x0, H, x0, 0);
    join(bottom.end, right.start);
    join(right.end, top.start);
    join(top.end, left.start);
    join(left.end, bottom.start);
    b.constrain({ type: 'horizontal', a: bottom.id });
    b.constrain({ type: 'horizontal', a: top.id });
    b.constrain({ type: 'vertical', a: right.id });
    b.constrain({ type: 'vertical', a: left.id });
    b.dimension({ type: 'distance', orientation: 'aligned', a: bottom.id }, W);
    if (cell === cells - 1 && options.freeLastHeight) dragPoint = right.end;
    else b.dimension({ type: 'distance', orientation: 'aligned', a: right.id }, H);
    const corner = bottom.start;
    if (previous && options.layout === 'chained') {
      dx(previous, corner, W + GAP);
      dy(previous, corner, 0);
    } else {
      dx(origin, corner, x0);
      dy(origin, corner, 0);
    }
    previous = corner;

    // Hole: Ø10 at (15, 15) from the corner.
    const hole = b.circle(x0 + 15, 15, 5);
    b.dimension({ type: 'diameter', curve: hole.id }, 10);
    dx(corner, hole.center, 15);
    dy(corner, hole.center, 15);

    // Slot: arc centres at (30, 15) and (42, 15), r = 4; arcs joined by two tangent lines.
    const r = 4;
    const arc1 = b.arc(x0 + 30, 15, r, 90, 270);
    const arc2 = b.arc(x0 + 42, 15, r, -90, 90);
    const slotBottom = b.line(x0 + 30, 15 - r, x0 + 42, 15 - r);
    const slotTop = b.line(x0 + 42, 15 + r, x0 + 30, 15 + r);
    join(arc1.end, slotBottom.start);
    join(slotBottom.end, arc2.start);
    join(arc2.end, slotTop.start);
    join(slotTop.end, arc1.start);
    for (const [arc, line] of [
      [arc1, slotBottom],
      [arc2, slotBottom],
      [arc2, slotTop],
      [arc1, slotTop],
    ] as const) {
      b.constrain({ type: 'tangent', a: arc.id, b: line.id });
    }
    b.constrain({ type: 'horizontal', a: slotBottom.id });
    b.constrain({ type: 'equal', a: arc1.id, b: arc2.id });
    b.dimension({ type: 'radius', curve: arc1.id }, r);
    b.dimension({ type: 'distance', orientation: 'aligned', a: arc1.center, b: arc2.center }, 12);
    dx(corner, arc1.center, 30);
    dy(corner, arc1.center, 15);
  }
  return { builder: b, entities: cells * CELL_ENTITIES, cells, dragPoint };
}

export interface GearOptions {
  teeth: number;
  noise?: number;
  /** Leave the tip radius free, so `dragPoint` (a tip corner) can move outward. */
  freeTip?: boolean;
}

export interface Gear {
  builder: SketchBuilder;
  entities: number;
  dragPoint: string;
}

/**
 * A gear-like outline around a fixed centre: per tooth a tip arc, a falling
 * flank, a root arc and a rising flank, joined end to end into one closed loop.
 * Tip and root arcs are concentric with the centre and equal; the flanks are
 * equal; chords fix the arcs' spans (all but the last root arc, which closes
 * the loop); the first tip starts on the X axis. DOF 0.
 */
export function gear(options: GearOptions): Gear {
  const b = new SketchBuilder({ noise: options.noise ?? 0 });
  const n = options.teeth;
  const tip = 40;
  const root = 34;
  const pitch = 360 / n;
  const at = (r: number, deg: number): [number, number] => [
    r * Math.cos((deg * Math.PI) / 180),
    r * Math.sin((deg * Math.PI) / 180),
  ];
  const chord = (r: number, span: number) => 2 * r * Math.sin((span * Math.PI) / 360);
  const centre = b.point(0, 0);
  b.constrain({ type: 'fix', entity: centre });
  const join = (p: string, q: string) => b.constrain({ type: 'coincident', a: p, b: q });

  const tips: ReturnType<SketchBuilder['arc']>[] = [];
  const roots: ReturnType<SketchBuilder['arc']>[] = [];
  const falls: ReturnType<SketchBuilder['line']>[] = [];
  const rises: ReturnType<SketchBuilder['line']>[] = [];
  const [t0, t1, r0, r1] = [0, 0.25, 0.4, 0.85].map((f) => f * pitch) as [
    number,
    number,
    number,
    number,
  ];
  for (let i = 0; i < n; i++) {
    const base = i * pitch;
    tips.push(b.arc(0, 0, tip, base + t0, base + t1));
    falls.push(b.line(...at(tip, base + t1), ...at(root, base + r0)));
    roots.push(b.arc(0, 0, root, base + r0, base + r1));
    rises.push(b.line(...at(root, base + r1), ...at(tip, base + pitch)));
  }
  for (let i = 0; i < n; i++) {
    const [t, f, r, u] = [tips[i], falls[i], roots[i], rises[i]] as [
      (typeof tips)[number],
      (typeof falls)[number],
      (typeof roots)[number],
      (typeof rises)[number],
    ];
    const nextTip = tips[(i + 1) % n] as (typeof tips)[number];
    join(t.center, centre);
    join(r.center, centre);
    join(t.end, f.start);
    join(f.end, r.start);
    join(r.end, u.start);
    join(u.end, nextTip.start);
    b.dimension(
      { type: 'distance', orientation: 'aligned', a: t.start, b: t.end },
      chord(tip, t1 - t0),
    );
    if (i < n - 1) {
      b.dimension(
        { type: 'distance', orientation: 'aligned', a: r.start, b: r.end },
        chord(root, r1 - r0),
      );
    }
    if (i === 0) {
      if (!options.freeTip) b.dimension({ type: 'radius', curve: t.id }, tip);
      b.dimension({ type: 'radius', curve: r.id }, root);
      const flank = (from: number, fromR: number, to: number, toR: number) => {
        const [x1, y1] = at(fromR, from);
        const [x2, y2] = at(toR, to);
        return Math.hypot(x2 - x1, y2 - y1);
      };
      b.dimension({ type: 'distance', orientation: 'aligned', a: f.id }, flank(t1, tip, r0, root));
      b.dimension(
        { type: 'distance', orientation: 'aligned', a: u.id },
        flank(r1, root, pitch, tip),
      );
      b.constrain({ type: 'horizontal', a: centre, b: t.start });
    } else {
      const first = { t: tips[0], r: roots[0], f: falls[0], u: rises[0] } as {
        t: typeof t;
        r: typeof r;
        f: typeof f;
        u: typeof u;
      };
      b.constrain({ type: 'equal', a: first.t.id, b: t.id });
      b.constrain({ type: 'equal', a: first.r.id, b: r.id });
      b.constrain({ type: 'equal', a: first.f.id, b: f.id });
      b.constrain({ type: 'equal', a: first.u.id, b: u.id });
    }
  }
  return { builder: b, entities: 4 * n, dragPoint: (tips[0] as (typeof tips)[number]).end };
}
