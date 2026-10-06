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
import {
  type AttachmentId,
  AttachmentIdSchema,
  ConstraintIdSchema,
  DimensionIdSchema,
  ProjectionIdSchema,
  type SketchEntityId,
  SketchEntityIdSchema,
} from '../ids';
import { PARAMETER_NAME } from '../names';
import { type GeomRef, GeomRefSchema } from '../refs';
import { z } from '../zod';

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
 * A spline (P1-05, P4-05, FR-SK-03): a smooth curve through or guided by its
 * points in order. The curve is derived from the points (`splineCurve` in
 * `sketch/curves.ts`), so the solver sees only the points.
 *
 * - `fit` (no `mode`, what P1-05 wrote): a smooth curve through every point.
 * - `control`: the points are the B-spline's poles; the curve starts at the
 *   first and ends at the last, tangent to the control polygon there, and does
 *   not pass through the ones between.
 * - `conic`: exactly three points — start, shoulder (where the end tangents
 *   meet) and end — and a `rho` (0 < rho < 1) that says how full the conic is:
 *   below 0.5 an ellipse arc, 0.5 a parabola, above a hyperbola arc.
 *
 * A conic's own curve is a rational quadratic, which the kernel can't take, so
 * it is stored exactly (three points and rho) and drawn as a cubic
 * approximation within 1e-5 mm (`conicSpline`), itself built from adaptively
 * subdivided cubic pieces.
 */
export const SketchSplineSchema = z.strictObject({
  type: z.literal('spline'),
  points: z.array(ref).min(2),
  /** How the points shape the curve; absent means 'fit', so P1-05 files stay as they are. */
  mode: z.enum(['fit', 'control', 'conic']).optional(),
  /** A conic's fullness; only for `mode: 'conic'`, and then required. */
  rho: z.number().gt(0).lt(1).optional(),
  construction: z.boolean(),
});

/**
 * A font ID says which font file a text is shaped with. A bundled one carries
 * its version: `family-style@n`, e.g. `inter-regular@1` (ADR-0058 §3), and
 * never changes its file. A user font added to this design is
 * `attachment:<AttachmentId>` (P4-03b, ADR-0061 §1), naming an entry of
 * `doc.attachments` whose bytes travel with the design.
 */
export const FontIdSchema = z
  .string()
  .regex(/^(?:[a-z0-9-]+@[0-9]+|attachment:[A-Za-z0-9][A-Za-z0-9._-]*)$/);
export type FontId = z.infer<typeof FontIdSchema>;

/** The prefix a user font's ID carries (ADR-0061 §1). */
export const ATTACHMENT_FONT_PREFIX = 'attachment:';

/**
 * The attachment a font ID names, or `undefined` for a bundled font. The ID
 * part is parsed as an ID, so an `attachment:` font with nothing after it is
 * no attachment at all (the schema's regex refuses it anyway).
 */
export function attachmentFontId(font: string): AttachmentId | undefined {
  if (!font.startsWith(ATTACHMENT_FONT_PREFIX)) return undefined;
  const parsed = AttachmentIdSchema.safeParse(font.slice(ATTACHMENT_FONT_PREFIX.length));
  return parsed.success ? parsed.data : undefined;
}

/**
 * A text entity (P4-03, FR-SK-13, ADR-0058 §1): the string `text` laid out
 * with font `font`, placed by two points — `anchor` sits on the first line's
 * baseline, `top` one text height above it ("up" for the text). The height is
 * `|top − anchor|` and means the font's cap height; the baseline runs 90°
 * clockwise from `top − anchor`, and `align` aligns each line about the
 * anchor. No number is stored: the two points carry size and rotation, so the
 * solver, dragging and dimensions work on them. The curves are derived
 * (`placeText` in `sketch/text.ts`), so the solver sees only the two points,
 * and constraints and dimensions may not refer to the entity itself.
 */
export const SketchTextSchema = z.strictObject({
  type: z.literal('text'),
  /** A point on the first line's baseline. */
  anchor: ref,
  /** A point one text height above `anchor`: the text's "up". */
  top: ref,
  /** The string, `\n` separating lines. */
  text: z.string().min(1).max(1000),
  font: FontIdSchema,
  align: z.enum(['left', 'center', 'right']),
  construction: z.boolean(),
});

export const SketchEntitySchema = z.discriminatedUnion('type', [
  SketchPointSchema,
  SketchLineSchema,
  SketchCircleSchema,
  SketchArcSchema,
  SketchEllipseSchema,
  SketchSplineSchema,
  SketchTextSchema,
]);

export type SketchPoint = z.infer<typeof SketchPointSchema>;
export type SketchLine = z.infer<typeof SketchLineSchema>;
export type SketchCircle = z.infer<typeof SketchCircleSchema>;
export type SketchArc = z.infer<typeof SketchArcSchema>;
export type SketchEllipse = z.infer<typeof SketchEllipseSchema>;
export type SketchSpline = z.infer<typeof SketchSplineSchema>;
export type SketchText = z.infer<typeof SketchTextSchema>;
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

/**
 * The name the UI gives each constraint type (FR-SK-07). A point on a curve
 * is "Coincident" too, as in the Coincident tool that makes it.
 */
export const CONSTRAINT_LABELS: Readonly<Record<SketchConstraintType, string>> = {
  coincident: 'Coincident',
  pointOnCurve: 'Coincident',
  collinear: 'Collinear',
  concentric: 'Concentric',
  midpoint: 'Midpoint',
  fix: 'Fix',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  tangent: 'Tangent',
  smooth: 'Smooth',
  equal: 'Equal',
  symmetric: 'Symmetric',
};

/** The entities a constraint refers to, in field order (a symmetry's axis last). */
export function constraintRefs(c: SketchConstraint): SketchEntityId[] {
  switch (c.type) {
    case 'pointOnCurve':
      return [c.point, c.curve];
    case 'midpoint':
      return [c.point, c.of];
    case 'fix':
      return [c.entity];
    case 'horizontal':
    case 'vertical':
      return c.b === undefined ? [c.a] : [c.a, c.b];
    case 'symmetric':
      return [c.a, c.b, c.axis];
    default:
      return [c.a, c.b];
  }
}

// Dimensions (FR-SK-08) ------------------------------------------------------

/** Every dimension's value is an expression, like every other number (ADR-0004). */
const value = {
  expr: z.string(),
  /** The model parameter (`d17`) the dimension shows up as in the parameters table. */
  paramName: z.string().regex(PARAMETER_NAME).optional(),
  /** A driven (reference) dimension measures the geometry instead of driving it. */
  driven: z.boolean(),
  /**
   * Where the value's label sits (P1-07): an offset in sketch mm from the
   * dimension's anchor (`dimensionAnchor`), so the label follows the
   * geometry. Without it the label goes to a default spot.
   */
  label: z.strictObject({ x: z.number(), y: z.number() }).optional(),
};

/**
 * `distance` covers linear dimensions: a line's length (`a` alone), two
 * points (aligned, horizontal or vertical), a point and a line, or two
 * parallel lines (aligned only).
 *
 * `angle` is the angle between the two lines' directions (start → end),
 * 0–180°; with `supplement` it is 180° minus that, the other pair of angles
 * where the lines cross (P1-07: the sector the label was placed in).
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
  z.strictObject({
    type: z.literal('angle'),
    a: ref,
    b: ref,
    supplement: z.boolean().optional(),
    ...value,
  }),
]);
export type SketchDimension = z.infer<typeof SketchDimensionSchema>;
export type SketchDimensionType = SketchDimension['type'];

// Projections (P2-09, FR-SK-12) -------------------------------------------------

/**
 * Model geometry projected into the sketch (the Project tool, ADR-0031): a
 * body edge, or a face (its boundary edges and, for cylinders and cones,
 * its silhouette lines), kept associative. The curves are ordinary entities
 * of the sketch, fixed where the kernel projects them: the kernel reports
 * the projection on every recompute (`SketchReport`) and the app moves
 * them there (`syncProjections`), solving the sketch so geometry
 * constrained to them follows.
 *
 * `curves` maps what each curve comes from (the source edge's persistent
 * name, `sil:<n>` for a face's silhouette, `sil:<face>:<n>` for a body's,
 * `edge` for a projected edge itself, `vertex` for a projected vertex,
 * `cut:<n>` for an intersection curve) to its entity, or to `null` once the
 * user deleted that curve, so it doesn't come back.
 *
 * P4-12 (ADR-0031's amendment): `ref` may also be a vertex (one fixed point)
 * or a body (its outline along the sketch normal); `mode: 'intersect'` makes
 * the curves where the face or body meets the sketch plane instead of its
 * projection; `linked: false` is an include waiting for the kernel's report,
 * which the app turns into plain entities and drops the record with.
 */
export const SketchProjectionSchema = z.strictObject({
  ref: GeomRefSchema.describe('The projected edge, face, vertex or body (a persistent reference).'),
  curves: z
    .record(z.string(), SketchEntityIdSchema.nullable())
    .describe("Each curve's source key to its sketch entity, or null once deleted."),
  mode: z
    .enum(['project', 'intersect'])
    .optional()
    .describe(
      'project (the default): the source seen along the sketch normal; intersect: where it meets the sketch plane.',
    ),
  linked: z
    .literal(false)
    .optional()
    .describe(
      'false: an include (no link), turned into plain entities once the kernel reports the curves.',
    ),
});
export type SketchProjection = z.infer<typeof SketchProjectionSchema>;

// The sketch -----------------------------------------------------------------

export const SketchDataSchema = z
  .strictObject({
    entities: z.record(SketchEntityIdSchema, SketchEntitySchema),
    constraints: z.record(ConstraintIdSchema, SketchConstraintSchema),
    dimensions: z.record(DimensionIdSchema, SketchDimensionSchema),
    /** Projected model geometry (P2-09); absent in sketches without any. */
    projections: z.record(ProjectionIdSchema, SketchProjectionSchema).optional(),
  })
  .superRefine((sketch, ctx) => {
    for (const issue of sketchIssues(sketch)) {
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  });
export type SketchData = z.infer<typeof SketchDataSchema>;

// Reference checks -----------------------------------------------------------

const PROJECTABLE: readonly string[] = ['edge', 'face', 'vertex', 'body'];
const INTERSECTABLE: readonly string[] = ['face', 'body'];

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
  'point,line,circle,arc,ellipse,spline': 'a point, line, circle, arc, ellipse or spline',
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
  projections?: Record<
    string,
    { ref: GeomRef; curves: Record<string, string | null>; mode?: 'project' | 'intersect' }
  >;
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
        // P4-05: a conic is three points and a rho; the other modes have no rho.
        if (entity.mode === 'conic') {
          if (entity.points.length !== 3) {
            issues.push({
              path: ['entities', id, 'points'],
              message: `a conic has 3 points (start, shoulder, end), not ${entity.points.length}`,
            });
          }
          if (entity.rho === undefined) {
            issues.push({ path: ['entities', id, 'rho'], message: 'a conic needs a rho' });
          }
        } else if (entity.rho !== undefined) {
          issues.push({
            path: ['entities', id, 'rho'],
            message: 'only a conic has a rho',
          });
        }
        break;
      case 'text':
        e('anchor', entity.anchor);
        e('top', entity.top);
        distinct('entities', id, [entity.anchor, entity.top]);
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

  // Each curve belongs to at most one projection; projections are of edges, faces,
  // vertices and bodies (P4-12), intersections of faces and bodies.
  const projectedBy = new Map<string, string>();
  for (const [id, projection] of Object.entries(sketch.projections ?? {})) {
    const kinds = projection.mode === 'intersect' ? INTERSECTABLE : PROJECTABLE;
    if (!kinds.includes(projection.ref.kind)) {
      fail(
        'projections',
        id,
        projection.mode === 'intersect'
          ? `must intersect a face or a body, not a ${projection.ref.kind}`
          : `must project an edge, a face, a vertex or a body, not a ${projection.ref.kind}`,
      );
    }
    for (const [key, curve] of Object.entries(projection.curves)) {
      if (curve === null) continue;
      const path = ['projections', id, 'curves', key];
      const kind = kindOf(curve);
      if (!kind) issues.push({ path, message: `refers to missing entity "${curve}"` });
      else if ((kind === 'point' && projection.ref.kind !== 'vertex') || kind === 'text') {
        issues.push({
          path,
          message: kind === 'point' ? 'must be a curve, not a point' : 'must be a curve, not text',
        });
      }
      const other = projectedBy.get(curve);
      if (other) issues.push({ path, message: `"${curve}" is also projected by "${other}"` });
      else projectedBy.set(curve, id);
    }
  }

  // One ID space per sketch, so a selection can hold entities, constraints and dimensions.
  const lists = ['entities', 'constraints', 'dimensions', 'projections'] as const;
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const id of Object.keys(sketch[list] ?? {})) {
      const other = seen.get(id);
      if (other) issues.push({ path: [list, id], message: `ID is also used in ${other}` });
      else seen.set(id, list);
    }
  }
  return issues;
}
