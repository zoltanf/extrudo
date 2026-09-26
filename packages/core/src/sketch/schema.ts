/**
 * The sketch schema (P1-01, ADR-0010): a sketch's 2D content, stored in the
 * sketch feature's `sketchData` input. The sketch's plane is a separate `ref`
 * input (`sketch/feature.ts`), like every other reference to geometry.
 *
 * Coordinates are in mm in the plane's own 2D frame (`sketch/planes.ts`).
 * The solved values are stored, so a sketch draws at once after loading and
 * the solver starts from the last solution (architecture §4.1).
 *
 * The model follows the solver's (ADR-0002): points are entities of their
 * own, and curves refer to them. Each point belongs to at most one curve:
 * two lines that meet share no point, a coincident constraint joins their
 * endpoints, as in FreeCAD and Fusion.
 * Entities, constraints and dimensions are records keyed by ID rather than
 * arrays, so deleting one gives one small undo patch instead of shifting
 * every later element.
 */
import { z } from 'zod';
import { ConstraintIdSchema, DimensionIdSchema, SketchEntityIdSchema } from '../ids';
import { PARAMETER_NAME } from '../names';

const ref = SketchEntityIdSchema;

// Entities --------------------------------------------------------------------

export const SketchPointSchema = z.strictObject({
  type: z.literal('point'),
  x: z.number(),
  y: z.number(),
});

export const SketchLineSchema = z.strictObject({
  type: z.literal('line'),
  start: ref,
  end: ref,
  /** Construction geometry (dashed) helps constrain but never forms profiles. */
  construction: z.boolean(),
});

export const SketchCircleSchema = z.strictObject({
  type: z.literal('circle'),
  center: ref,
  radius: z.number().positive(),
  construction: z.boolean(),
});

/** Counter-clockwise from `start` to `end` around `center`; the radius is the distance to `start`. */
export const SketchArcSchema = z.strictObject({
  type: z.literal('arc'),
  center: ref,
  start: ref,
  end: ref,
  construction: z.boolean(),
});

/**
 * An ellipse (P1-05) from three points: the center, the end of the major
 * axis, and the end of the minor axis. The solver keeps `minor` square to the
 * major axis on the ellipse (`sketch/curves.ts` reads the shape), so no
 * number is stored: radii and rotation are the points' distances and angle.
 */
export const SketchEllipseSchema = z.strictObject({
  type: z.literal('ellipse'),
  center: ref,
  major: ref,
  minor: ref,
  construction: z.boolean(),
});

/**
 * A fit-point spline (P1-05, FR-SK-03): a smooth curve through its points in
 * order. The curve is derived from the points (`fitSpline` in
 * `sketch/curves.ts`), so the solver sees only the points.
 */
export const SketchSplineSchema = z.strictObject({
  type: z.literal('spline'),
  points: z.array(ref).min(2),
  construction: z.boolean(),
});

export const SketchEntitySchema = z.discriminatedUnion('type', [
  SketchPointSchema,
  SketchLineSchema,
  SketchCircleSchema,
  SketchArcSchema,
  SketchEllipseSchema,
  SketchSplineSchema,
]);

export type SketchPoint = z.infer<typeof SketchPointSchema>;
export type SketchLine = z.infer<typeof SketchLineSchema>;
export type SketchCircle = z.infer<typeof SketchCircleSchema>;
export type SketchArc = z.infer<typeof SketchArcSchema>;
export type SketchEllipse = z.infer<typeof SketchEllipseSchema>;
export type SketchSpline = z.infer<typeof SketchSplineSchema>;
export type SketchEntity = z.infer<typeof SketchEntitySchema>;
export type SketchEntityType = SketchEntity['type'];

// Constraints (FR-SK-07) -----------------------------------------------------

const pair = <T extends string>(type: T) =>
  z.strictObject({ type: z.literal(type), a: ref, b: ref });

/**
 * Where two curves meet at an endpoint, whether their directions there point
 * opposite ways (lines run start → end, circles and arcs counter-clockwise).
 * The solver keeps the joint on that side (P1-03). Set when the constraint is
 * created; without it, the solver picks the side from the current geometry.
 */
const joint = <T extends string>(type: T) =>
  z.strictObject({ type: z.literal(type), a: ref, b: ref, reversed: z.boolean().optional() });

/**
 * Geometric constraints. `coincident` joins two points; `pointOnCurve` puts a
 * point on a line, circle, arc or ellipse (the UI calls both "coincident").
 * Splines take only `fix` for now: their shape follows their points.
 * `horizontal` and `vertical` take a line (`a`) or two points (`a`, `b`).
 */
export const SketchConstraintSchema = z.discriminatedUnion('type', [
  pair('coincident'),
  z.strictObject({ type: z.literal('pointOnCurve'), point: ref, curve: ref }),
  pair('collinear'),
  pair('concentric'),
  z.strictObject({ type: z.literal('midpoint'), point: ref, of: ref }),
  z.strictObject({ type: z.literal('fix'), entity: ref }),
  pair('parallel'),
  pair('perpendicular'),
  z.strictObject({ type: z.literal('horizontal'), a: ref, b: ref.optional() }),
  z.strictObject({ type: z.literal('vertical'), a: ref, b: ref.optional() }),
  joint('tangent'),
  joint('smooth'),
  pair('equal'),
  z.strictObject({ type: z.literal('symmetric'), a: ref, b: ref, axis: ref }),
]);
export type SketchConstraint = z.infer<typeof SketchConstraintSchema>;
export type SketchConstraintType = SketchConstraint['type'];

// Dimensions (FR-SK-08) ------------------------------------------------------

/** Every dimension's value is an expression, like every other number (ADR-0004). */
const value = {
  expr: z.string(),
  /** The model parameter (`d17`) the dimension shows up as in the parameters table. */
  paramName: z.string().regex(PARAMETER_NAME).optional(),
  /** A driven (reference) dimension measures the geometry instead of driving it. */
  driven: z.boolean(),
};

/**
 * `distance` covers linear dimensions: a line's length (`a` alone), two
 * points (aligned, horizontal or vertical), a point and a line, or two
 * parallel lines (aligned only).
 */
export const SketchDimensionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('distance'),
    orientation: z.enum(['aligned', 'horizontal', 'vertical']),
    a: ref,
    b: ref.optional(),
    ...value,
  }),
  z.strictObject({ type: z.literal('radius'), curve: ref, ...value }),
  z.strictObject({ type: z.literal('diameter'), curve: ref, ...value }),
  z.strictObject({ type: z.literal('angle'), a: ref, b: ref, ...value }),
]);
export type SketchDimension = z.infer<typeof SketchDimensionSchema>;
export type SketchDimensionType = SketchDimension['type'];

// The sketch -----------------------------------------------------------------

export const SketchDataSchema = z
  .strictObject({
    entities: z.record(SketchEntityIdSchema, SketchEntitySchema),
    constraints: z.record(ConstraintIdSchema, SketchConstraintSchema),
    dimensions: z.record(DimensionIdSchema, SketchDimensionSchema),
  })
  .superRefine((sketch, ctx) => {
    for (const issue of sketchIssues(sketch)) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });
export type SketchData = z.infer<typeof SketchDataSchema>;

// Reference checks -----------------------------------------------------------

type Kinds = readonly SketchEntityType[];
const POINT: Kinds = ['point'];
const LINE: Kinds = ['line'];
const ROUND: Kinds = ['circle', 'arc'];
const CURVE: Kinds = ['line', 'circle', 'arc'];
const ON_CURVE: Kinds = ['line', 'circle', 'arc', 'ellipse'];
const SYMMETRIC: Kinds = ['point', 'line', 'circle', 'arc'];
const ANY: Kinds = ['point', 'line', 'circle', 'arc', 'ellipse', 'spline'];

const KIND_NAMES: Record<string, string> = {
  point: 'a point',
  line: 'a line',
  'circle,arc': 'a circle or an arc',
  'line,circle,arc': 'a line, circle or arc',
  'line,circle,arc,ellipse': 'a line, circle, arc or ellipse',
  'point,line,circle,arc': 'a point, line, circle or arc',
  'line,arc': 'a line or an arc',
  'point,line': 'a point or a line',
  'line,point': 'a line or a point',
};

export interface SketchIssue {
  path: (string | number)[];
  message: string;
}

/**
 * What's wrong with a sketch's references: missing entities, the wrong kind
 * of entity (a circle as a line's endpoint), an entity constrained to itself,
 * and IDs used in two lists. An empty list means the sketch is consistent.
 * The schema runs it on load; it doesn't check geometry (that's the solver's
 * job, P1-03).
 */
export function sketchIssues(sketch: {
  entities: Record<string, SketchEntity>;
  constraints: Record<string, SketchConstraint>;
  dimensions: Record<string, SketchDimension>;
}): SketchIssue[] {
  const issues: SketchIssue[] = [];
  const { entities } = sketch;
  const kindOf = (id: string | undefined) => (id === undefined ? undefined : entities[id]?.type);

  const expect = (
    list: string,
    owner: string,
    field: string,
    id: string | undefined,
    kinds: Kinds,
  ): SketchEntityType | undefined => {
    if (id === undefined) return undefined;
    const kind = kindOf(id);
    if (!kind) {
      issues.push({ path: [list, owner, field], message: `refers to missing entity "${id}"` });
    } else if (!kinds.includes(kind)) {
      issues.push({
        path: [list, owner, field],
        message: `must be ${KIND_NAMES[kinds.join(',')] ?? kinds.join(' or ')}, not ${kind === 'ellipse' ? 'an' : 'a'} ${kind}`,
      });
    }
    return kind;
  };
  const distinct = (list: string, owner: string, ids: (string | undefined)[]) => {
    const present = ids.filter((id) => id !== undefined);
    if (new Set(present).size < present.length) {
      issues.push({ path: [list, owner], message: 'refers to the same entity twice' });
    }
  };
  const fail = (list: string, owner: string, message: string) =>
    issues.push({ path: [list, owner], message });

  // Each point defines at most one curve; curves that meet are joined by constraints.
  const owners = new Map<string, string>();
  for (const [id, entity] of Object.entries(entities)) {
    const e = (field: string, ref: string) => {
      if (expect('entities', id, field, ref, POINT) !== 'point') return;
      const owner = owners.get(ref);
      if (owner && owner !== id) {
        issues.push({
          path: ['entities', id, field],
          message: `point "${ref}" already belongs to "${owner}"; join them with a constraint`,
        });
      } else owners.set(ref, id);
    };
    switch (entity.type) {
      case 'point':
        break;
      case 'line':
        e('start', entity.start);
        e('end', entity.end);
        distinct('entities', id, [entity.start, entity.end]);
        break;
      case 'circle':
        e('center', entity.center);
        break;
      case 'arc':
        e('center', entity.center);
        e('start', entity.start);
        e('end', entity.end);
        distinct('entities', id, [entity.center, entity.start, entity.end]);
        break;
      case 'ellipse':
        e('center', entity.center);
        e('major', entity.major);
        e('minor', entity.minor);
        distinct('entities', id, [entity.center, entity.major, entity.minor]);
        break;
      case 'spline':
        entity.points.forEach((p, i) => {
          e(`points.${i}`, p);
        });
        distinct('entities', id, entity.points);
        break;
    }
  }

  for (const [id, c] of Object.entries(sketch.constraints)) {
    const e = (field: string, ref: string | undefined, kinds: Kinds) =>
      expect('constraints', id, field, ref, kinds);
    switch (c.type) {
      case 'coincident':
        e('a', c.a, POINT);
        e('b', c.b, POINT);
        distinct('constraints', id, [c.a, c.b]);
        break;
      case 'pointOnCurve':
        e('point', c.point, POINT);
        e('curve', c.curve, ON_CURVE);
        break;
      case 'collinear':
      case 'parallel':
      case 'perpendicular':
        e('a', c.a, LINE);
        e('b', c.b, LINE);
        distinct('constraints', id, [c.a, c.b]);
        break;
      case 'concentric':
        e('a', c.a, ROUND);
        e('b', c.b, ROUND);
        distinct('constraints', id, [c.a, c.b]);
        break;
      case 'midpoint':
        e('point', c.point, POINT);
        e('of', c.of, ['line', 'arc']);
        break;
      case 'fix':
        e('entity', c.entity, ANY);
        break;
      case 'horizontal':
      case 'vertical': {
        const a = e('a', c.a, ['line', 'point']);
        if (a === 'line' && c.b !== undefined)
          fail('constraints', id, 'takes a line or two points');
        if (a === 'point') {
          if (c.b === undefined) fail('constraints', id, 'needs a second point');
          e('b', c.b, POINT);
          distinct('constraints', id, [c.a, c.b]);
        }
        break;
      }
      case 'tangent':
      case 'smooth': {
        const a = e('a', c.a, CURVE);
        const b = e('b', c.b, CURVE);
        distinct('constraints', id, [c.a, c.b]);
        if (a === 'line' && b === 'line') fail('constraints', id, "can't join two lines");
        break;
      }
      case 'equal': {
        const a = e('a', c.a, CURVE);
        const b = e('b', c.b, CURVE);
        distinct('constraints', id, [c.a, c.b]);
        if (a && b && (a === 'line') !== (b === 'line')) {
          fail('constraints', id, 'needs two lines, or two circles or arcs');
        }
        break;
      }
      case 'symmetric': {
        const a = e('a', c.a, SYMMETRIC);
        const b = e('b', c.b, SYMMETRIC);
        e('axis', c.axis, LINE);
        distinct('constraints', id, [c.a, c.b, c.axis]);
        const group = (k: SketchEntityType) => (k === 'arc' ? 'circle' : k);
        if (a && b && group(a) !== group(b)) {
          fail('constraints', id, 'needs two entities of the same kind');
        }
        break;
      }
    }
  }

  for (const [id, d] of Object.entries(sketch.dimensions)) {
    const e = (field: string, ref: string | undefined, kinds: Kinds) =>
      expect('dimensions', id, field, ref, kinds);
    switch (d.type) {
      case 'distance': {
        const a = e('a', d.a, ['point', 'line']);
        const b = e('b', d.b, ['point', 'line']);
        distinct('dimensions', id, [d.a, d.b]);
        if (d.b === undefined && a === 'point') fail('dimensions', id, 'needs a second entity');
        if (a && b && (a === 'line' || b === 'line') && d.orientation !== 'aligned') {
          fail('dimensions', id, 'to a line must be aligned');
        }
        break;
      }
      case 'radius':
      case 'diameter':
        e('curve', d.curve, ROUND);
        break;
      case 'angle':
        e('a', d.a, LINE);
        e('b', d.b, LINE);
        distinct('dimensions', id, [d.a, d.b]);
        break;
    }
  }

  // One ID space per sketch, so a selection can hold entities, constraints and dimensions.
  const lists = ['entities', 'constraints', 'dimensions'] as const;
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const id of Object.keys(sketch[list])) {
      const other = seen.get(id);
      if (other) issues.push({ path: [list, id], message: `ID is also used in ${other}` });
      else seen.set(id, list);
    }
  }
  return issues;
}
