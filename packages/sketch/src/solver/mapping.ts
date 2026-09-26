/**
 * SketchData → planegcs primitives (ADR-0002, ADR-0011). Pure: no WASM.
 *
 * Every entity, constraint and dimension becomes an `Item`: the planegcs
 * primitives it adds, the entities those primitives use, and the entities
 * whose unknowns it couples (`links`, for the component split). Primitive IDs
 * are the document IDs; an item that needs several primitives suffixes them
 * (`c7#0`, `c7#1`, `a3#rules`), and `docId()` strips the suffix again when
 * planegcs reports conflicts.
 *
 * Choices that depend on the geometry (which side of a tangent joint, which
 * endpoints a symmetry pairs, the sign of a horizontal distance, the quadrant
 * of an angle) are read from the current coordinates, which the document
 * stores solved, so they're stable from one solve to the next.
 */
import type {
  SketchArc,
  SketchCircle,
  SketchConstraint,
  SketchData,
  SketchDimension,
  SketchEllipse,
  SketchEntity,
  SketchLine,
  SketchPoint,
} from '@extrudo/core';
import type { SketchPrimitive } from '@salusoft89/planegcs/dist/sketch/sketch_primitive.js';

/** Driving dimension values in base units (mm, degrees), by dimension ID. */
export type DimensionValues = Readonly<Record<string, number>>;

export type ItemKind = 'point' | 'curve' | 'constraint' | 'dimension';

export interface Item {
  /** The document ID: an entity, constraint or dimension. */
  id: string;
  kind: ItemKind;
  prims: SketchPrimitive[];
  /** Entities the primitives reference (the item's own entity included). */
  uses: string[];
  /** The entities in `uses` that have unknowns: what the item couples. */
  links: string[];
  /** A driving dimension's value, bound as a sketch parameter named by its ID. */
  param?: { name: string; value: number };
  /** The document objects the item was made from, to tell whether it changed. */
  sources: unknown[];
}

export interface MappedSketch {
  /** Points, then curves, then constraints and dimensions (the order planegcs needs). */
  items: Item[];
  /** Entities without unknowns: fixed points, curves whose parameters are all fixed. */
  fixed: ReadonlySet<string>;
  /** Circles and arcs fixed as a whole: their radius and angles are fixed parameters too. */
  fixedCurves: ReadonlySet<string>;
  /** Dimensions left out: driven (they measure) or without a value. */
  skipped: string[];
}

export const PARAM_COUNT = { point: 2, line: 0, circle: 1, arc: 3, ellipse: 1, spline: 0 } as const;

/** The document ID a planegcs primitive ID came from. */
export const docId = (primId: string): string => {
  const hash = primId.indexOf('#');
  return hash < 0 ? primId : primId.slice(0, hash);
};

interface Vec {
  x: number;
  y: number;
}
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;

/** An arc's start and end angles with end > start (planegcs runs counter-clockwise). */
export function arcAngles(center: Vec, start: Vec, end: Vec) {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let a1 = Math.atan2(end.y - center.y, end.x - center.x);
  if (a1 <= a0) a1 += 2 * Math.PI;
  return { start: a0, end: a1, radius: Math.hypot(start.x - center.x, start.y - center.y) };
}

/**
 * planegcs's parameters for an ellipse given by its center, major-axis end
 * and minor-axis end: the focus on the major axis, toward the major end, and
 * the minor radius.
 */
export function ellipseParams(center: Vec, major: Vec, minor: Vec) {
  const u = sub(major, center);
  const a = Math.hypot(u.x, u.y);
  const m = sub(minor, center);
  const side = a === 0 ? 0 : cross(u, m) / a;
  const b = a === 0 ? Math.hypot(m.x, m.y) : Math.abs(side);
  // A focus needs a > b; a circle-like ellipse keeps a tiny focal distance so the axis stays defined.
  const c = Math.sqrt(Math.max(a * a - b * b, 1e-12 * a * a));
  const dir = a === 0 ? { x: 1, y: 0 } : { x: u.x / a, y: u.y / a };
  return { focus: { x: center.x + c * dir.x, y: center.y + c * dir.y }, radmin: b };
}

/** Collects every entity ID a primitive refers to (`*_id` fields and `{ o_id }` parameters). */
function referenced(prim: SketchPrimitive, out: Set<string>) {
  for (const [key, value] of Object.entries(prim)) {
    if (key === 'id') continue;
    if (key.endsWith('_id') && typeof value === 'string') out.add(value);
    else if (value && typeof value === 'object' && 'o_id' in value) out.add(String(value.o_id));
  }
}

export function mapSketch(sketch: SketchData, values: DimensionValues = {}): MappedSketch {
  const entities = sketch.entities as Record<string, SketchEntity>;
  const get = <T extends SketchEntity['type']>(id: string, type: T) => {
    const e = entities[id];
    if (e?.type !== type) throw new Error(`sketch entity "${id}" is not a ${type}`);
    return e as Extract<SketchEntity, { type: T }>;
  };
  const point = (id: string): SketchPoint => get(id, 'point');
  const pointsOf = (e: SketchEntity): string[] => {
    switch (e.type) {
      case 'point':
        return [];
      case 'line':
        return [e.start, e.end];
      case 'circle':
        return [e.center];
      case 'arc':
        return [e.center, e.start, e.end];
      case 'ellipse':
        return [e.center, e.major, e.minor];
      case 'spline':
        return e.points;
    }
  };
  const endpoints = (id: string): string[] => {
    const e = entities[id];
    return e?.type === 'line' || e?.type === 'arc' ? [e.start, e.end] : [];
  };

  // Fixed geometry --------------------------------------------------------------
  const fixedPoints = new Set<string>();
  const fixedCurves = new Set<string>();
  for (const c of Object.values(sketch.constraints)) {
    if (c.type !== 'fix') continue;
    const e = entities[c.entity];
    if (!e) continue;
    if (e.type === 'point') fixedPoints.add(c.entity);
    else {
      for (const p of pointsOf(e)) fixedPoints.add(p);
      // Lines and splines are their points; the others have parameters of their own.
      if (e.type !== 'line' && e.type !== 'spline') fixedCurves.add(c.entity);
    }
  }
  const fixed = new Set<string>(fixedPoints);
  for (const [id, e] of Object.entries(entities)) {
    if (e.type === 'line' && fixedPoints.has(e.start) && fixedPoints.has(e.end)) fixed.add(id);
    if (fixedCurves.has(id)) fixed.add(id);
  }

  // Coincident groups, for endpoint joints -------------------------------------
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) as string;
    return root;
  };
  for (const c of Object.values(sketch.constraints)) {
    if (c.type === 'coincident') parent.set(find(c.a), find(c.b));
  }
  const onCurve = new Set<string>();
  for (const c of Object.values(sketch.constraints)) {
    if (c.type === 'pointOnCurve') onCurve.add(`${c.point} ${c.curve}`);
  }
  /** Where curves `a` and `b` meet at an endpoint (the point used), if they do. */
  const joint = (a: string, b: string): string | undefined => {
    for (const pa of endpoints(a)) {
      for (const pb of endpoints(b)) if (find(pa) === find(pb)) return pa;
    }
    for (const pa of endpoints(a)) if (onCurve.has(`${pa} ${b}`)) return pa;
    for (const pb of endpoints(b)) if (onCurve.has(`${pb} ${a}`)) return pb;
    return undefined;
  };
  /** The curve's direction at a point: lines start → end, circles and arcs counter-clockwise. */
  const direction = (curve: string, at: string): Vec => {
    const e = entities[curve] as SketchLine | SketchCircle | SketchArc;
    if (e.type === 'line') return sub(point(e.end), point(e.start));
    const r = sub(point(at), point(e.center));
    return { x: -r.y, y: r.x };
  };

  // Items ----------------------------------------------------------------------
  const items: Item[] = [];
  const skipped: string[] = [];
  const add = (
    id: string,
    kind: ItemKind,
    prims: SketchPrimitive[],
    sources: unknown[],
    param?: Item['param'],
  ) => {
    const uses = new Set<string>(kind === 'point' || kind === 'curve' ? [id] : []);
    for (const prim of prims) referenced(prim, uses);
    // Solver-only primitives (an ellipse's focus) aren't entities: they link nothing.
    const list = [...uses].filter((u) => u in entities);
    items.push({
      id,
      kind,
      prims,
      uses: list,
      links: list.filter((u) => !fixed.has(u)),
      ...(param ? { param } : {}),
      sources,
    });
  };

  for (const [id, e] of Object.entries(entities)) {
    if (e.type !== 'point') continue;
    add(id, 'point', [{ id, type: 'point', x: e.x, y: e.y, fixed: fixedPoints.has(id) }], [e]);
  }
  for (const [id, e] of Object.entries(entities)) {
    switch (e.type) {
      case 'line':
        add(id, 'curve', [{ id, type: 'line', p1_id: e.start, p2_id: e.end }], [e]);
        break;
      case 'circle':
        add(id, 'curve', [{ id, type: 'circle', c_id: e.center, radius: e.radius }], [e]);
        break;
      case 'arc': {
        const angles = arcAngles(point(e.center), point(e.start), point(e.end));
        const prims: SketchPrimitive[] = [
          {
            id,
            type: 'arc',
            c_id: e.center,
            start_id: e.start,
            end_id: e.end,
            start_angle: angles.start,
            end_angle: angles.end,
            radius: angles.radius,
          },
        ];
        // A fixed arc has no unknowns left for its rules to relate.
        if (!fixedCurves.has(id)) prims.push({ id: `${id}#rules`, type: 'arc_rules', a_id: id });
        add(id, 'curve', prims, [e]);
        break;
      }
      case 'ellipse':
        add(id, 'curve', ellipsePrims(id, e), [e]);
        break;
      // A spline adds no unknowns and no equations: its shape follows its points.
    }
  }

  for (const [id, c] of Object.entries(sketch.constraints)) {
    const prims = constraintPrims(id, c);
    if (prims.length > 0) add(id, 'constraint', prims, [c]);
  }

  for (const [id, d] of Object.entries(sketch.dimensions)) {
    const value = values[id];
    if (d.driven || value === undefined || !Number.isFinite(value)) {
      skipped.push(id);
      continue;
    }
    const mapped = dimensionPrims(id, d, value);
    add(id, 'dimension', mapped.prims, [d], { name: id, value: mapped.param });
  }

  return { items, fixed, fixedCurves, skipped };

  // Constraints ----------------------------------------------------------------

  function constraintPrims(id: string, c: SketchConstraint): SketchPrimitive[] {
    const kind = (e: string) => entities[e]?.type;
    switch (c.type) {
      case 'coincident':
        return [{ id, type: 'p2p_coincident', p1_id: c.a, p2_id: c.b }];
      case 'pointOnCurve':
        switch (kind(c.curve)) {
          case 'line':
            return [{ id, type: 'point_on_line_pl', p_id: c.point, l_id: c.curve }];
          case 'circle':
            return [{ id, type: 'point_on_circle', p_id: c.point, c_id: c.curve }];
          case 'ellipse':
            return [{ id, type: 'point_on_ellipse', p_id: c.point, e_id: c.curve }];
          default:
            return [{ id, type: 'point_on_arc', p_id: c.point, a_id: c.curve }];
        }
      case 'collinear': {
        const b = get(c.b, 'line');
        return [
          { id: `${id}#0`, type: 'point_on_line_pl', p_id: b.start, l_id: c.a },
          { id: `${id}#1`, type: 'point_on_line_pl', p_id: b.end, l_id: c.a },
        ];
      }
      case 'concentric': {
        const a = entities[c.a] as SketchCircle | SketchArc;
        const b = entities[c.b] as SketchCircle | SketchArc;
        return [{ id, type: 'p2p_coincident', p1_id: a.center, p2_id: b.center }];
      }
      case 'midpoint': {
        const of = entities[c.of] as SketchLine | SketchArc;
        if (of.type === 'line') {
          return [{ id, type: 'p2p_symmetric_ppp', p1_id: of.start, p2_id: of.end, p_id: c.point }];
        }
        return [
          { id: `${id}#0`, type: 'point_on_arc', p_id: c.point, a_id: c.of },
          {
            id: `${id}#1`,
            type: 'point_on_perp_bisector_ppp',
            p_id: c.point,
            lp1_id: of.start,
            lp2_id: of.end,
          },
        ];
      }
      case 'fix':
        // Fixed parameters instead of equations (see `fixed`), so a fixed
        // entity links nothing and joins no component.
        return [];
      case 'parallel':
        return [{ id, type: 'parallel', l1_id: c.a, l2_id: c.b }];
      case 'perpendicular':
        return [{ id, type: 'perpendicular_ll', l1_id: c.a, l2_id: c.b }];
      case 'horizontal':
      case 'vertical': {
        const axis = c.type === 'horizontal' ? 'horizontal' : 'vertical';
        if (c.b === undefined) return [{ id, type: `${axis}_l`, l_id: c.a }];
        return [{ id, type: `${axis}_pp`, p1_id: c.a, p2_id: c.b }];
      }
      case 'tangent':
      case 'smooth':
        // Smooth (G2) matters for splines (P1-05); between lines and arcs it's tangency.
        return tangentPrims(id, c.a, c.b, c.reversed);
      case 'equal': {
        const [ka, kb] = [kind(c.a), kind(c.b)];
        if (ka === 'line') return [{ id, type: 'equal_length', l1_id: c.a, l2_id: c.b }];
        if (ka === 'circle' && kb === 'circle') {
          return [{ id, type: 'equal_radius_cc', c1_id: c.a, c2_id: c.b }];
        }
        if (ka === 'arc' && kb === 'arc') {
          return [{ id, type: 'equal_radius_aa', a1_id: c.a, a2_id: c.b }];
        }
        const [circle, arc] = ka === 'circle' ? [c.a, c.b] : [c.b, c.a];
        return [{ id, type: 'equal_radius_ca', c1_id: circle, a2_id: arc }];
      }
      case 'symmetric':
        return symmetricPrims(id, c.a, c.b, c.axis);
    }
  }

  /**
   * planegcs describes an ellipse by its center, a focus and the minor
   * radius. The focus is a solver-only point (`<id>#focus`) placed from the
   * document's points. Two solver-only lines hold the axis points: the major
   * point is on the ellipse and on the center–focus axis (a vertex); the
   * minor point is on a line square to that axis, at the minor radius from
   * the center. (planegcs's internal-alignment constraints would say this
   * directly, but in our build they converge without moving anything.)
   */
  function ellipsePrims(id: string, e: SketchEllipse): SketchPrimitive[] {
    const shape = ellipseParams(point(e.center), point(e.major), point(e.minor));
    const isFixed = fixedCurves.has(id);
    const focus = `${id}#focus`;
    const prims: SketchPrimitive[] = [
      { id: focus, type: 'point', x: shape.focus.x, y: shape.focus.y, fixed: isFixed },
      { id, type: 'ellipse', c_id: e.center, focus1_id: focus, radmin: shape.radmin },
    ];
    if (isFixed) return prims;
    const axis = `${id}#axis`;
    const across = `${id}#across`;
    prims.push(
      { id: axis, type: 'line', p1_id: e.center, p2_id: focus },
      { id: across, type: 'line', p1_id: e.center, p2_id: e.minor },
      { id: `${id}#majorOn`, type: 'point_on_ellipse', p_id: e.major, e_id: id },
      { id: `${id}#majorAxis`, type: 'point_on_line_pl', p_id: e.major, l_id: axis },
      { id: `${id}#square`, type: 'perpendicular_ll', l1_id: axis, l2_id: across },
      {
        id: `${id}#minor`,
        type: 'p2p_distance',
        p1_id: e.center,
        p2_id: e.minor,
        distance: { o_id: id, prop: 'radmin' },
      },
    );
    return prims;
  }

  function tangentPrims(
    id: string,
    a: string,
    b: string,
    reversed: boolean | undefined,
  ): SketchPrimitive[] {
    // At an endpoint joint, tangent_* plus the coincident constraint is
    // degenerate at the solution (false redundancies, wrong DOF; ADR-0002):
    // constrain the angle between the curves at the joint instead.
    const at = joint(a, b);
    if (at !== undefined) {
      const opposite = reversed ?? dot(direction(a, at), direction(b, at)) < 0;
      return [
        {
          id,
          type: 'angle_via_point',
          crv1_id: a,
          crv2_id: b,
          p_id: at,
          angle: opposite ? Math.PI : 0,
        },
      ];
    }
    const ka = entities[a]?.type;
    const kb = entities[b]?.type;
    if (ka === 'line' || kb === 'line') {
      const [line, round] = ka === 'line' ? [a, b] : [b, a];
      return entities[round]?.type === 'circle'
        ? [{ id, type: 'tangent_lc', l_id: line, c_id: round }]
        : [{ id, type: 'tangent_la', l_id: line, a_id: round }];
    }
    if (ka === 'circle' && kb === 'circle') return [{ id, type: 'tangent_cc', c1_id: a, c2_id: b }];
    if (ka === 'arc' && kb === 'arc') return [{ id, type: 'tangent_aa', a1_id: a, a2_id: b }];
    const [circle, arc] = ka === 'circle' ? [a, b] : [b, a];
    return [{ id, type: 'tangent_ca', c_id: circle, a_id: arc }];
  }

  function symmetricPrims(id: string, a: string, b: string, axis: string): SketchPrimitive[] {
    const ea = entities[a] as SketchEntity;
    const eb = entities[b] as SketchEntity;
    const sym = (n: number, p1: string, p2: string): SketchPrimitive => ({
      id: `${id}#${n}`,
      type: 'p2p_symmetric_ppl',
      p1_id: p1,
      p2_id: p2,
      l_id: axis,
    });
    if (ea.type === 'point') return [{ ...sym(0, a, b), id }];
    if (ea.type === 'line' && eb.type === 'line') {
      // Pair each endpoint with the one its mirror image lies nearer to.
      const line = get(axis, 'line');
      const o = point(line.start);
      const u = sub(point(line.end), o);
      const mirror = (p: Vec): Vec => {
        const t = dot(sub(p, o), u) / (dot(u, u) || 1);
        const foot = { x: o.x + t * u.x, y: o.y + t * u.y };
        return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
      };
      const m = mirror(point(ea.start));
      const d = (p: string) => Math.hypot(point(p).x - m.x, point(p).y - m.y);
      const [s, e] = d(eb.start) <= d(eb.end) ? [eb.start, eb.end] : [eb.end, eb.start];
      return [sym(0, ea.start, s), sym(1, ea.end, e)];
    }
    // Circles: mirrored centres and equal radii. Arcs: mirrored endpoints (a
    // mirrored arc runs the other way, so a's start is the image of b's end)
    // and equal radii; the centres follow. Mirrored centres plus one
    // endpoint would already imply the radius, and planegcs would call it redundant.
    const ra = ea as SketchCircle | SketchArc;
    const rb = eb as SketchCircle | SketchArc;
    const prims: SketchPrimitive[] = [];
    if (ra.type === 'arc' && rb.type === 'arc') {
      prims.push(sym(0, ra.start, rb.end), sym(1, ra.end, rb.start));
      prims.push({ id: `${id}#2`, type: 'equal_radius_aa', a1_id: a, a2_id: b });
    } else if (ra.type === 'circle' && rb.type === 'circle') {
      prims.push(sym(0, ra.center, rb.center));
      prims.push({ id: `${id}#1`, type: 'equal_radius_cc', c1_id: a, c2_id: b });
    } else {
      prims.push(sym(0, ra.center, rb.center));
      const [circle, arc] = ra.type === 'circle' ? [a, b] : [b, a];
      prims.push({ id: `${id}#1`, type: 'equal_radius_ca', c1_id: circle, a2_id: arc });
    }
    return prims;
  }

  // Dimensions -----------------------------------------------------------------

  function dimensionPrims(
    id: string,
    d: SketchDimension,
    value: number,
  ): { prims: SketchPrimitive[]; param: number } {
    switch (d.type) {
      case 'distance': {
        const ka = entities[d.a]?.type;
        const kb = d.b === undefined ? undefined : entities[d.b]?.type;
        let [p, q] = ka === 'line' && d.b === undefined ? line(d.a) : [d.a, d.b as string];
        if (d.orientation === 'aligned') {
          if (ka === 'line' && kb === 'line') {
            return {
              prims: [{ id, type: 'p2l_distance', p_id: line(q)[0], l_id: p, distance: id }],
              param: value,
            };
          }
          if (ka === 'line' && kb === 'point') {
            return {
              prims: [{ id, type: 'p2l_distance', p_id: q, l_id: p, distance: id }],
              param: value,
            };
          }
          if (ka === 'point' && kb === 'line') {
            return {
              prims: [{ id, type: 'p2l_distance', p_id: p, l_id: q, distance: id }],
              param: value,
            };
          }
          return {
            prims: [{ id, type: 'p2p_distance', p1_id: p, p2_id: q, distance: id }],
            param: value,
          };
        }
        // Horizontal or vertical: a signed difference, measured the way the geometry lies now.
        const prop = d.orientation === 'horizontal' ? 'x' : 'y';
        if (point(q)[prop] < point(p)[prop]) [p, q] = [q, p];
        return {
          prims: [
            {
              id,
              type: 'difference',
              param1: { o_id: p, prop },
              param2: { o_id: q, prop },
              difference: id,
            },
          ],
          param: value,
        };
      }
      case 'radius':
        return entities[d.curve]?.type === 'circle'
          ? { prims: [{ id, type: 'circle_radius', c_id: d.curve, radius: id }], param: value }
          : { prims: [{ id, type: 'arc_radius', a_id: d.curve, radius: id }], param: value };
      case 'diameter':
        return entities[d.curve]?.type === 'circle'
          ? { prims: [{ id, type: 'circle_diameter', c_id: d.curve, diameter: id }], param: value }
          : { prims: [{ id, type: 'arc_diameter', a_id: d.curve, diameter: id }], param: value };
      case 'angle': {
        // planegcs constrains the signed angle from a's direction to b's. The
        // dimension is unsigned (0–180° between the directions); the sign is
        // the side b lies on now, so a new value turns b without flipping it.
        const la = get(d.a, 'line');
        const lb = get(d.b, 'line');
        const u = sub(point(la.end), point(la.start));
        const v = sub(point(lb.end), point(lb.start));
        const sign = cross(u, v) < 0 ? -1 : 1;
        // A supplement dimensions the other pair of angles where the lines cross.
        const between = d.supplement ? 180 - value : value;
        return {
          prims: [{ id, type: 'l2l_angle_ll', l1_id: d.a, l2_id: d.b, angle: id }],
          param: (sign * between * Math.PI) / 180,
        };
      }
    }
  }

  function line(id: string): [string, string] {
    const l = get(id, 'line');
    return [l.start, l.end];
  }
}
