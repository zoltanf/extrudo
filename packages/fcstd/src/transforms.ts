/**
 * PartDesign's transforms (ADR-0144 S7): LinearPattern, PolarPattern,
 * Mirrored and the MultiTransform chains the importer maps, as Extrudo's
 * `rectangularPattern`, `circularPattern` and `mirror` of features.
 *
 * **References.** A direction, axis or plane is first worked out in world
 * coordinates from the file (a sketch's frame, an origin feature, or an edge
 * or face of a feature's stored shape described by the import kernel), then
 * written as the Extrudo reference that *is* that line or plane: an origin
 * axis or plane when it coincides with one, else the sketch's own line (the
 * importer draws the H and V axes when the sketch is added) or plane, else
 * the edge or face matched on the rebuilt body (S6's matcher: exactly one
 * candidate, never an index), else construction features made in the same
 * transaction (points through which an axis or plane goes; a plane through
 * a sketch line square to the sketch is a `planeAtAngle` of 90°).
 *
 * **Senses.** FreeCAD steps along the line's own direction (a sketch axis's,
 * an origin axis's, a straight edge's curve: not the edge's orientation) and
 * turns right-handed about it; `Reversed` goes the other way. Extrudo steps
 * along its reference's direction: a sketch line's start to end (drawn as
 * FreeCAD's), an origin axis's, an edge's canonical direction (its first
 * non-zero component positive, `describe`), and turns right-handed. Where the
 * two directions disagree the distance or angle is negated.
 */
import type { Design } from '@extrudo/api';
import {
  circularPatternInputs,
  type ExprInput,
  type GeomRef,
  mirrorInputs,
  ORIGIN_AXES,
  ORIGIN_PLANES,
  rectangularPatternInputs,
  type SketchEntityId,
  sketchEntityRefId,
} from '@extrudo/core';
import { mapModeOf, supportsOf } from './attach';
import type { CallOutcome, KernelBudget } from './budget';
import type { ReferenceTally } from './dressups';
import {
  type DecodedReference,
  type DecodedRow,
  type DecodedStep,
  type DecodedTransform,
  MAX_FEATURE_LENGTH,
} from './features';
import { rotate } from './final-shapes';
import type { ElementEdge, ElementFace, ShapeElements, SubShapeAt } from './import-kernel';
import { append } from './lists';
import {
  cellFor,
  checkReference,
  detailRadius,
  ElementIndex,
  saneBodies,
  saneElements,
} from './match';
import { type FcDocument, type FcObject, storedShapeText } from './model';
import { cleanName } from './names';
import {
  type DecodedSketch,
  externalLinkOf,
  type FcGeometry,
  GEO_UNDEF,
  MAX_SKETCH_GEOMETRY,
  type Vec2,
} from './sketch-decode';
import { arcEnds, type ExternalPlan, MAX_CANDIDATES } from './sketch-map';
import {
  containerChain,
  fitsOriginPlane,
  frameIsSound,
  type GivenPlane,
  sketchFrame,
} from './sketch-place';
import type { AddSketchResult } from './sketches';

type Vec3 = readonly [number, number, number];
type ImportedSketch = Extract<AddSketchResult, { imported: true }>;

export interface Line {
  readonly origin: Vec3;
  /** Unit, in FreeCAD's sense. */
  readonly direction: Vec3;
}
export interface Plane {
  readonly origin: Vec3;
  readonly normal: Vec3;
}

/** How far off a face's plane a sketch may lie and still stay on it: S9's tolerances for a datum (a sine; mm). */
const SKETCH_FACE_PARALLEL = 1e-9;
const SKETCH_FACE_ON = 1e-7;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const unit = (v: Vec3): Vec3 => scale(v, 1 / norm(v));
const literal = (v: number) => `${Number(v.toPrecision(15))}`;

/** A finite point within the lengths the importer takes (`MAX_FEATURE_LENGTH` from the origin, each coordinate). */
const inRange = (p: Vec3) =>
  p.every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_FEATURE_LENGTH);
/** A line or plane that is one: a point in range and a finite direction of unit length. */
const sound = (origin: Vec3, direction: Vec3) =>
  inRange(origin) && direction.every(Number.isFinite) && Math.abs(norm(direction) - 1) <= 1e-9;
const unsound = (what: string): TransformStop => ({
  stop: 'transform-reference',
  detail: `its ${what} is no line or plane the importer can use (no length, no direction, or past ${MAX_FEATURE_LENGTH} mm)`,
});

/** Two lines that are one: parallel, and the one's origin on the other. */
const collinear = (a: Line, b: Line) =>
  norm(cross(a.direction, b.direction)) <= PARALLEL &&
  norm(cross(sub(a.origin, b.origin), b.direction)) <= onTolerance(a.origin);

/** How far off parallel two unit directions may be and count as one (a sine). */
const PARALLEL = 1e-9;
/** How far (mm) a point may be off a line or plane and count as on it, plus 1e-9 of its distance from the origin. */
const ON = 1e-7;
const onTolerance = (p: Vec3) => ON + 1e-9 * norm(p);

/**
 * Canonical direction, as the kernel's `describe` gives a line's: the first
 * component above 1e-9 in size made positive.
 */
export function canonical(d: Vec3): Vec3 {
  for (const v of d) if (Math.abs(v) > 1e-9) return v < 0 ? scale(d, -1) : d;
  return d;
}

/** Why a transform can't come in (the walk stops its body with it). */
export type TransformStop = {
  readonly stop:
    | 'transform-reference'
    | 'multi-transform'
    | 'reference'
    | 'element'
    | 'limit'
    | 'stored'
    | 'failed'
    | Exclude<CallOutcome<unknown>, { kind: 'done' }>['kind'];
  readonly detail: string;
  readonly references?: ReferenceTally;
};

export interface TransformContext {
  readonly doc: FcDocument;
  readonly design: Design;
  readonly budget: KernelBudget;
  /** The FreeCAD body. */
  readonly body: FcObject;
  /** The sketches imported for this body, by FreeCAD name. */
  readonly sketches: ReadonlyMap<string, ImportedSketch>;
  readonly sketchOf: (name: string) => DecodedSketch | undefined;
  /** The FreeCAD body's Extrudo bodies of the last rebuild, and the Extrudo features that made them. */
  readonly mine: readonly string[];
  readonly own: ReadonlySet<string>;
  /** The FreeCAD features of this body walked so far (an `EdgeN` must name one of them). */
  readonly walked: ReadonlySet<string>;
  /** The feature's name in the design. */
  readonly name: string;
  /** Some container of the body has a placement other than the identity (S9: no origin-plane relation then). */
  readonly moved?: boolean;
  /** Prefer an origin axis or plane where one coincides (tests turn it off to reach the others). */
  readonly originFirst?: boolean;
  /** The datums brought in so far in this import, by FreeCAD name (S9): one construction per datum. */
  readonly datums?: Map<string, DatumMade>;
  /** The most datums one import brings in (`MAX_DATUMS`; tests lower it). */
  readonly maxDatums?: number;
  /** External links projected so far in this import, and the most it may project (S9). */
  readonly externalBudget?: { used: number; readonly max: number };
  /**
   * What the feature being walked found so far, by `<object>|<kind>|<index>`
   * (S9's fix round): stored descriptions and matches on the body as it was
   * before the feature's first try, which every later try reuses. A failed
   * try's rebuild is the kernel's last recompute and still holds the
   * cancelled feature, so nothing may be matched again after it.
   */
  readonly found?: Map<string, Found>;
}

/** One lookup of a feature's tries (`TransformContext.found`). */
export type Found =
  | {
      readonly stored:
        | { stored: ShapeElements; element: ElementEdge | ElementFace }
        | TransformStop;
    }
  | {
      readonly match: GeomRef | TransformStop;
      readonly tally: { found: number; none: number; several: number; furthest: number };
    };

/**
 * Why a named external curve didn't come in as a projection (S9's fix round):
 * reported elsewhere by the kernel, past a cap, its link not found, a vertex,
 * a source outside the body's walked features (another body, a ShapeBinder, a
 * Part feature, a later feature), a sketch line that didn't come in, a curve
 * the importer doesn't project (`kind`: not a line, nor a circle or an arc of
 * one square to the sketch, or one whose numbers make none), a stored shape
 * that can't be read, or
 * no or several counterparts on the rebuilt body. `unused`: projected, but no
 * constraint naming it was kept.
 */
export type ExternalCause =
  | 'elsewhere'
  | 'limit'
  | 'link'
  | 'vertex'
  | 'source'
  | 'sketch-line'
  | 'kind'
  | 'stored'
  | 'none'
  | 'several'
  | 'unused';

/** How far (mm) an arc's ends and middle may be off its circle, plus 1e-9 of the centre's distance from the origin (S9's arcs). */
const ARC_ON = 1e-6;

/**
 * An arc of a circle in the sketch from a stored edge projected along the
 * sketch's normal (S9's arcs): its centre, radius, two ends and the point at
 * its middle, in the sketch's coordinates. Which of the two arcs between the
 * ends it is comes from the middle point, never from the order of the ends;
 * it runs counter-clockwise from its start, as FreeCAD's arcs do.
 * `undefined` when they make no arc: a radius of zero, not finite or past
 * `MAX_FEATURE_LENGTH`, an end or the middle off the circle, the two ends on
 * each other, or the middle on an end.
 */
export function arcThrough(
  center: Vec2,
  radius: number,
  a: Vec2,
  b: Vec2,
  mid: Vec2,
): Extract<FcGeometry, { kind: 'arc' }> | undefined {
  const all = [...center, radius, ...a, ...b, ...mid];
  if (!all.every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_FEATURE_LENGTH)) return undefined;
  const tol = ARC_ON + 1e-9 * Math.hypot(center[0], center[1]);
  if (!(radius > tol)) return undefined;
  const off = (p: Vec2) => Math.hypot(p[0] - center[0], p[1] - center[1]);
  if (![a, b, mid].every((p) => Math.abs(off(p) - radius) <= tol)) return undefined;
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= tol) return undefined;
  const angle = (p: Vec2) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const turn = 2 * Math.PI;
  const ccw = (from: number, to: number) => (((to - from) % turn) + turn) % turn;
  const a0 = angle(a);
  const sweep = ccw(a0, angle(b));
  const m = ccw(a0, angle(mid));
  const gap = tol / radius;
  if (m <= gap || Math.abs(m - sweep) <= gap || turn - m <= gap) return undefined;
  // Counter-clockwise from a to b passes the middle, or the arc runs from b to a.
  const [startAngle, span] = m < sweep ? [a0, sweep] : [angle(b), turn - sweep];
  return {
    kind: 'arc',
    center,
    radius,
    angleXU: 0,
    reversed: false,
    startAngle,
    endAngle: startAngle + span,
    construction: true,
    internal: 0,
  };
}

/** Whether a planned arc is one to draw: its ends apart (a sweep of more than nothing), its radius not zero (S9's arcs). */
function arcFits(c: Extract<FcGeometry, { kind: 'arc' }>): boolean {
  const tol = ARC_ON + 1e-9 * Math.hypot(c.center[0], c.center[1]);
  const { start, end } = arcEnds(c);
  return (
    c.radius > tol &&
    Number.isFinite(c.startAngle) &&
    Number.isFinite(c.endAngle) &&
    Math.hypot(end[0] - start[0], end[1] - start[1]) > tol
  );
}

/** The most external links of one sketch that are projected (S9): the rest stay out as before. */
export const MAX_EXTERNAL_PER_SKETCH = 64;
/** The most external links one import projects (S9). */
export const MAX_EXTERNAL_PER_FILE = 1_000;

/** A datum line or plane brought in (S9): its Extrudo reference and its world line or plane. */
export interface DatumMade {
  readonly ref: GeomRef;
  /** How it came in: an origin axis or plane, a relation kept (on an origin plane, along an edge or a sketch line), or fixed. */
  readonly how: 'origin' | 'offset' | 'edge' | 'sketch-line' | 'fixed';
  readonly mode: string;
  readonly line?: Line;
  readonly plane?: Plane;
  /** A plane's construction's own normal (a sketch on it takes that plane's frame; it may point against `plane.normal`). */
  readonly normal?: Vec3;
  /** The construction features it made (none for an origin axis or plane). */
  readonly features: readonly string[];
}

/** Whether `name` is an origin axis or plane of `body`'s own origin. */
function ownOriginFeature(doc: FcDocument, body: FcObject, name: string): boolean {
  const v = body.properties.Origin?.value;
  const origin = v?.kind === 'link' && v.object ? doc.byName.get(v.object) : undefined;
  const list = origin?.properties.OriginFeatures?.value;
  return list?.kind === 'linkList' && list.objects.includes(name);
}

/** Stops that are a kernel call's outcome, never remembered for a later try. */
const CALL_STOPS: ReadonlySet<string> = new Set(['kernel', 'time', 'restarts', 'import-time']);

/** The most datums one import brings in: past it a feature that needs one more is refused (`limit`). */
export const MAX_DATUMS = 200;

/** What a rebuild's report must say for a datum's construction (S9's check). */
export interface DatumCheck {
  readonly feature: string;
  readonly name: string;
  readonly line?: Line;
  readonly plane?: Plane;
}

/** What a transform repeats: features' tools, or (its originals are every feature of the body) the body. */
export type Repeated =
  | { readonly features: readonly string[] }
  | { readonly bodies: readonly string[] };

const objectsOf = (what: Repeated) =>
  'features' in what ? { features: what.features } : { bodies: what.bodies, join: true };

/** A line as an Extrudo reference, with the direction Extrudo reads from it. */
interface LineRef {
  readonly ref: GeomRef;
  readonly along: Vec3;
  readonly fc: Vec3;
}

const callDetail = (o: Exclude<CallOutcome<unknown>, { kind: 'done' }>) =>
  'detail' in o && o.detail ? o.detail : o.kind;

const expr = (value: string, unit: 'length' | 'angle'): ExprInput => ({
  kind: 'expr',
  expr: value,
  unit,
});

/** Resolves and adds; the walk holds it (one transaction, rebuilt and checked). */
export class TransformMapper {
  readonly #c: TransformContext;
  /** How the edges and faces named were found. */
  readonly tally = { found: 0, none: 0, several: 0, furthest: 0 };
  #matched = false;
  /** Construction features made, for the report. */
  constructions = 0;
  /** The datums this mapper brought in (S9), and what each construction's report must say. */
  readonly datumsMade: DatumMade[] = [];
  readonly checks: DatumCheck[] = [];

  constructor(context: TransformContext) {
    this.#c = context;
  }

  get references(): ReferenceTally | undefined {
    return this.#matched ? { ...this.tally } : undefined;
  }

  // ------------------------------------------------------------ geometry from the file

  #frame(sketch: string) {
    const o = this.#c.doc.byName.get(sketch) as FcObject;
    const g = sketchFrame(this.#c.doc, o).global;
    const q = g.rotation;
    return {
      origin: g.position,
      x: rotate(q, [1, 0, 0]),
      y: rotate(q, [0, 1, 0]),
      n: rotate(q, [0, 0, 1]),
    };
  }

  /** A sketch line's ends in world coordinates. */
  #sketchLine(sketch: string, geometry: number): Line | TransformStop {
    const g = this.#c.sketchOf(sketch)?.geometry[geometry];
    if (g?.kind !== 'line')
      return { stop: 'transform-reference', detail: 'its line is not in the sketch' };
    const f = this.#frame(sketch);
    const at = (p: readonly [number, number]) =>
      add(f.origin, add(scale(f.x, p[0]), scale(f.y, p[1])));
    const a = at(g.start);
    const d = sub(at(g.end), a);
    if (!(norm(d) > 1e-9)) return { stop: 'transform-reference', detail: 'its line has no length' };
    return { origin: a, direction: unit(d) };
  }

  /** The element's stored description, described once per feature (`found`). */
  async #stored(
    object: string,
    kind: 'edge' | 'face',
    index: number,
    name: string,
  ): Promise<{ stored: ShapeElements; element: ElementEdge | ElementFace } | TransformStop> {
    const key = `${object}|${kind}|${index}|stored`;
    const known = this.#c.found?.get(key);
    if (known && 'stored' in known) return known.stored;
    const got = await this.#describeStored(object, kind, index, name);
    if (!('stop' in got) || !CALL_STOPS.has(got.stop)) this.#c.found?.set(key, { stored: got });
    return got;
  }

  async #describeStored(
    object: string,
    kind: 'edge' | 'face',
    index: number,
    name: string,
  ): Promise<{ stored: ShapeElements; element: ElementEdge | ElementFace } | TransformStop> {
    const { doc, budget } = this.#c;
    if (!this.#c.walked.has(object))
      return {
        stop: 'transform-reference',
        detail: `its reference ${cleanName(name, 'nothing')} is on ${cleanName(object, object)}, not a feature of this body before it`,
      };
    const o = doc.byName.get(object) as FcObject;
    const before = doc.problems.length;
    const text = storedShapeText(doc, o);
    const said = doc.problems.splice(before);
    if (text === undefined)
      return {
        stop: 'stored',
        detail: `its reference's shape can't be read: ${said.join(' ') || 'none'}`,
      };
    const chain = containerChain(doc, o)?.chain ?? [];
    const ask = { edges: kind === 'edge' ? [index] : [], faces: kind === 'face' ? [index] : [] };
    let stored: ShapeElements | undefined;
    const described = await budget.call(
      () => budget.kernel.describeStoredShape(text, chain, ask),
      (reply: unknown): reply is ShapeElements => {
        stored = saneElements(reply, ask);
        if (!stored) return false;
        // The element asked for must be there (a reply may hold others), unless a cap or the count says why not.
        const count = kind === 'edge' ? stored.edgeCount : stored.faceCount;
        const list: readonly { index: number }[] = kind === 'edge' ? stored.edges : stored.faces;
        return stored.over !== undefined || index >= count || list.some((e) => e.index === index);
      },
    );
    if (described.kind !== 'done') return { stop: described.kind, detail: callDetail(described) };
    const s = stored as ShapeElements;
    if (s.over !== undefined)
      return {
        stop: 'limit',
        detail: `the shape its reference is on has more than the importer describes`,
      };
    const count = kind === 'edge' ? s.edgeCount : s.faceCount;
    if (index >= count)
      return {
        stop: 'element',
        detail: `it names ${cleanName(name, 'nothing')}, but ${cleanName(object, object)} has ${count} ${kind}${count === 1 ? '' : 's'}`,
      };
    const element = (kind === 'edge' ? s.edges : s.faces).find((e) => e.index === index) as
      | ElementEdge
      | ElementFace;
    return { stored: s, element };
  }

  /**
   * Finds a stored edge or face on the rebuilt body and returns its persistent
   * reference: on the body before the feature, once per feature (`found`, by
   * `key`), so a later try reuses what the first found.
   */
  async #match(
    element: ElementEdge | ElementFace,
    kind: 'edge' | 'face',
    what: string,
    key: string,
  ): Promise<GeomRef | TransformStop> {
    this.#matched = true;
    const k = `${key}|match`;
    const known = this.#c.found?.get(k);
    const before = { ...this.tally };
    if (known && 'match' in known) {
      this.tally.found += known.tally.found;
      this.tally.none += known.tally.none;
      this.tally.several += known.tally.several;
      this.tally.furthest = Math.max(this.tally.furthest, known.tally.furthest);
      return 'stop' in known.match && known.match.references
        ? { ...known.match, references: { ...this.tally } }
        : known.match;
    }
    const got = await this.#findOnBody(element, kind, what);
    if (!('stop' in got) || !CALL_STOPS.has(got.stop))
      this.#c.found?.set(k, {
        match: got,
        tally: {
          found: this.tally.found - before.found,
          none: this.tally.none - before.none,
          several: this.tally.several - before.several,
          furthest: this.tally.furthest,
        },
      });
    return got;
  }

  async #findOnBody(
    element: ElementEdge | ElementFace,
    kind: 'edge' | 'face',
    what: string,
  ): Promise<GeomRef | TransformStop> {
    const { budget, mine, design } = this.#c;
    const point =
      kind === 'edge' ? (element as ElementEdge).midpoint : (element as ElementFace).centroid;
    const cell = cellFor([point]);
    let bodies: Map<string, ShapeElements> | undefined;
    const rebuilt = await budget.call(
      () => budget.kernel.describeBodies(mine, { points: [point], radius: detailRadius(cell) }),
      (reply: unknown): reply is Record<string, ShapeElements> => {
        bodies = saneBodies(reply, mine);
        return bodies !== undefined;
      },
    );
    if (rebuilt.kind !== 'done') return { stop: rebuilt.kind, detail: callDetail(rebuilt) };
    for (const [, d] of bodies as Map<string, ShapeElements>)
      if (d.over !== undefined)
        return { stop: 'limit', detail: 'its body has more than the importer describes' };
    const index = new ElementIndex(bodies as Map<string, ShapeElements>, cell);
    const l =
      kind === 'edge' ? index.edge(element as ElementEdge) : index.face(element as ElementFace);
    if (l.kind !== 'one') {
      if (l.kind === 'none') this.tally.none++;
      else this.tally.several++;
      return {
        stop: 'reference',
        detail:
          l.kind === 'none'
            ? `${what} has no counterpart on the rebuilt body`
            : `${what} has ${l.count} counterparts on the rebuilt body`,
        references: { ...this.tally },
      };
    }
    this.tally.found++;
    this.tally.furthest = Math.max(this.tally.furthest, l.distance);
    const item: SubShapeAt = { body: l.at.body, kind, index: l.at.index };
    const sent = new Set(design.doc.features.map((f) => f.id as string));
    let ref: GeomRef | undefined;
    let tooLarge: string | undefined;
    const named = await budget.call(
      () => budget.kernel.references([item]),
      (reply: unknown): reply is (GeomRef | undefined)[] => {
        if (!Array.isArray(reply) || reply.length !== 1 || reply[0] === undefined) return false;
        const r = checkReference(reply[0], kind, sent, this.#c.own);
        if (r.ok) ref = r.ref;
        else if (r.limit !== undefined) tooLarge = r.limit;
        else return false;
        return true;
      },
    );
    if (named.kind !== 'done')
      return { stop: named.kind, detail: callDetail(named), references: { ...this.tally } };
    if (tooLarge !== undefined)
      return {
        stop: 'reference',
        detail: `a reference to ${what}: ${tooLarge}`,
        references: { ...this.tally },
      };
    return ref as GeomRef;
  }

  // ------------------------------------------------------------ construction

  /** `design.add` of a construction feature, refused (`failed`) where Extrudo refuses it. */
  #construct(type: string, inputs: unknown, name: string): string | TransformStop {
    try {
      const id = this.#c.design.add(type as never, inputs as never, { name }).id;
      this.constructions++;
      return id;
    } catch (error) {
      return { stop: 'failed', detail: `Extrudo refused its ${name}: ${(error as Error).message}` };
    }
  }

  #point(p: Vec3, n: number, name = this.#c.name): GeomRef | TransformStop {
    if (!inRange(p)) return unsound('reference');
    const id = this.#construct(
      'constructionPoint',
      {
        x: expr(`${literal(p[0])} mm`, 'length'),
        y: expr(`${literal(p[1])} mm`, 'length'),
        z: expr(`${literal(p[2])} mm`, 'length'),
      },
      `${name} point ${n}`,
    );
    return typeof id === 'string' ? { kind: 'point', id } : id;
  }

  /** An axis through two construction points: the line exactly, pointing FreeCAD's way. */
  #axisOf(line: Line, name?: string): GeomRef | TransformStop {
    // Points 10 mm apart about the line's origin keep the numbers as given.
    const a = this.#point(line.origin, 1, name);
    if ('stop' in a) return a;
    const b = this.#point(add(line.origin, scale(line.direction, 10)), 2, name);
    if ('stop' in b) return b;
    const id = this.#construct(
      'axisThroughPoints',
      { points: { kind: 'ref', refs: [a, b] } },
      name ?? `${this.#c.name} axis`,
    );
    return typeof id === 'string' ? { kind: 'axis', id } : id;
  }

  /** A plane through three construction points. */
  #planeOf(plane: Plane, name?: string): GeomRef | TransformStop {
    const n = unit(plane.normal);
    // Two directions in the plane: one square to the normal's largest component.
    const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = unit(cross(n, helper));
    const v = cross(n, u);
    const p = [plane.origin, add(plane.origin, scale(u, 10)), add(plane.origin, scale(v, 10))];
    const refs: GeomRef[] = [];
    for (const [i, x] of p.entries()) {
      const r = this.#point(x, i + 1, name);
      if ('stop' in r) return r;
      refs.push(r);
    }
    const id = this.#construct(
      'planeThroughPoints',
      { points: { kind: 'ref', refs } },
      name ?? `${this.#c.name} plane`,
    );
    return typeof id === 'string' ? { kind: 'plane', id } : id;
  }

  // ------------------------------------------------------------ references

  #originAxis(line: Line): LineRef | undefined {
    if (this.#c.originFirst === false) return undefined;
    for (const a of ORIGIN_AXES) {
      const d = a.direction as Vec3;
      // Comparisons that a non-finite number fails (NaN is never parallel or on the axis).
      if (!(norm(cross(d, line.direction)) <= PARALLEL)) continue;
      // On the axis: the line's origin has no part square to it.
      const off = sub(line.origin, scale(d, dot(line.origin, d)));
      if (!(norm(off) <= onTolerance(line.origin))) continue;
      return { ref: { kind: 'axis', id: a.id }, along: d, fc: line.direction };
    }
    return undefined;
  }

  #originPlane(plane: Plane): GeomRef | undefined {
    if (this.#c.originFirst === false) return undefined;
    for (const p of ORIGIN_PLANES) {
      const n = p.frame.normal as Vec3;
      if (!(norm(cross(n, unit(plane.normal))) <= PARALLEL)) continue;
      if (!(Math.abs(dot(plane.origin, n)) <= onTolerance(plane.origin))) continue;
      return { kind: 'plane', id: p.id };
    }
    return undefined;
  }

  /** The drawn Extrudo line of a sketch axis or line, when the sketch came in with it. */
  #drawn(reference: DecodedReference): GeomRef | undefined {
    if (reference.kind !== 'sketch-axis' && reference.kind !== 'sketch-line') return undefined;
    const s = this.#c.sketches.get(reference.sketch);
    if (!s) return undefined;
    const entity =
      reference.kind === 'sketch-line'
        ? s.lines[reference.geometry]
        : reference.axis === 'n'
          ? undefined
          : s.axes[reference.axis];
    return entity === undefined
      ? undefined
      : { kind: 'sketchEntity', id: sketchEntityRefId(s.id, entity as SketchEntityId) };
  }

  /** A direction or an axis as an Extrudo line reference. */
  async line(reference: DecodedReference, what: string): Promise<LineRef | TransformStop> {
    let line: Line;
    if (
      reference.kind === 'origin-plane' ||
      (reference.kind === 'element' && reference.element.kind === 'face')
    )
      return {
        stop: 'transform-reference',
        detail: `its ${what} is a plane or a face, which this importer doesn't map as a ${what}`,
      };
    if (reference.kind === 'datum') {
      const d = await this.datum(reference.object, 'line', what);
      if ('stop' in d) return d;
      const l = d.line as Line;
      const along = d.ref.kind === 'edge' ? canonical(l.direction) : (d.along ?? l.direction);
      return { ref: d.ref, along, fc: l.direction };
    }
    if (reference.kind === 'origin-axis') {
      const a = ORIGIN_AXES.find((x) => x.id === `origin:${reference.axis}`);
      return {
        ref: { kind: 'axis', id: `origin:${reference.axis}` },
        along: a?.direction as Vec3,
        fc: a?.direction as Vec3,
      };
    }
    if (reference.kind === 'sketch-axis') {
      const f = this.#frame(reference.sketch);
      line = {
        origin: f.origin,
        direction: reference.axis === 'h' ? f.x : reference.axis === 'v' ? f.y : f.n,
      };
    } else if (reference.kind === 'sketch-line') {
      const l = this.#sketchLine(reference.sketch, reference.geometry);
      if ('stop' in l) return l;
      line = l;
    } else {
      const found = await this.#stored(
        reference.object,
        'edge',
        reference.element.index,
        reference.element.name,
      );
      if ('stop' in found) return found;
      const e = found.element as ElementEdge;
      if (e.type !== 'line' || e.ends?.length !== 2)
        return {
          stop: 'transform-reference',
          detail: `its ${what} ${cleanName(reference.element.name, 'nothing')} is not a straight edge`,
        };
      // FreeCAD takes the line's own direction: the curve's first end to its last (FORMAT.md).
      const [a, b] = e.ends as [Vec3, Vec3];
      if (!(norm(sub(b, a)) > 1e-9))
        return {
          stop: 'transform-reference',
          detail: `its ${what} ${cleanName(reference.element.name, 'nothing')} has no length`,
        };
      line = { origin: a, direction: unit(sub(b, a)) };
      if (!sound(line.origin, line.direction)) return unsound(what);
      const origin = this.#originAxis(line);
      if (origin) return origin;
      const ref = await this.#match(
        e,
        'edge',
        `its ${what} ${cleanName(reference.element.name, 'nothing')}`,
        `${reference.object}|edge|${reference.element.index}`,
      );
      if ('stop' in ref) return ref;
      return { ref, along: canonical(line.direction), fc: line.direction };
    }
    if (!sound(line.origin, line.direction)) return unsound(what);
    const origin = this.#originAxis(line);
    if (origin) return origin;
    const drawn = this.#drawn(reference);
    if (drawn) return { ref: drawn, along: line.direction, fc: line.direction };
    const axis = this.#axisOf(line);
    if ('stop' in axis) return axis;
    return { ref: axis, along: line.direction, fc: line.direction };
  }

  /** A mirror plane as an Extrudo plane reference. */
  async plane(reference: DecodedReference): Promise<GeomRef | TransformStop> {
    if (reference.kind === 'origin-plane')
      return { kind: 'plane', id: `origin:${reference.plane}` };
    if (reference.kind === 'datum') {
      const d = await this.datum(reference.object, 'plane', 'mirror plane');
      return 'stop' in d ? d : d.ref;
    }
    if (
      reference.kind === 'origin-axis' ||
      (reference.kind === 'element' && reference.element.kind === 'edge')
    )
      return { stop: 'transform-reference', detail: 'its mirror plane is a line or an edge' };
    if (reference.kind === 'element') {
      const found = await this.#stored(
        reference.object,
        'face',
        reference.element.index,
        reference.element.name,
      );
      if ('stop' in found) return found;
      const face = found.element as ElementFace;
      if (face.type !== 'plane' || !face.direction || !(norm(face.direction) > 1e-9))
        return {
          stop: 'transform-reference',
          detail: `its mirror plane ${cleanName(reference.element.name, 'nothing')} is not a flat face`,
        };
      if (!sound(face.centroid, unit(face.direction))) return unsound('mirror plane');
      const origin = this.#originPlane({ origin: face.centroid, normal: face.direction });
      if (origin) return origin;
      return this.#match(
        face,
        'face',
        `its mirror plane ${cleanName(reference.element.name, 'nothing')}`,
        `${reference.object}|face|${reference.element.index}`,
      );
    }
    const f = this.#frame(reference.sketch);
    const sketch = this.#c.sketches.get(reference.sketch);
    if (reference.kind === 'sketch-axis' && reference.axis === 'n') {
      const plane = { origin: f.origin, normal: f.n };
      if (!sound(plane.origin, plane.normal)) return unsound('mirror plane');
      return this.#originPlane(plane) ?? sketch?.plane ?? this.#planeOf(plane);
    }
    // The plane through the line and the sketch's normal.
    let line: Line;
    if (reference.kind === 'sketch-axis')
      line = { origin: f.origin, direction: reference.axis === 'h' ? f.x : f.y };
    else {
      const l = this.#sketchLine(reference.sketch, reference.geometry);
      if ('stop' in l) return l;
      line = l;
    }
    const plane = { origin: line.origin, normal: unit(cross(line.direction, f.n)) };
    if (!sound(plane.origin, plane.normal)) return unsound('mirror plane');
    const origin = this.#originPlane(plane);
    if (origin) return origin;
    const drawn = this.#drawn(reference);
    if (drawn && sketch) {
      const id = this.#construct(
        'planeAtAngle',
        {
          axis: { kind: 'ref', refs: [drawn] },
          plane: { kind: 'ref', refs: [sketch.plane] },
          angle: expr('90 deg', 'angle'),
        },
        `${this.#c.name} plane`,
      );
      return typeof id === 'string' ? { kind: 'plane', id } : id;
    }
    return this.#planeOf(plane);
  }

  /**
   * An up-to target (S9): a face of a feature found on the rebuilt body (flat
   * or curved; S6's matcher, exactly one candidate), or an origin plane.
   */
  async face(reference: DecodedReference, what: string): Promise<GeomRef | TransformStop> {
    if (reference.kind === 'origin-plane')
      return { kind: 'plane', id: `origin:${reference.plane}` };
    if (reference.kind === 'datum') {
      const d = await this.datum(reference.object, 'plane', what);
      return 'stop' in d ? d : d.ref;
    }
    if (reference.kind !== 'element' || reference.element.kind !== 'face')
      return { stop: 'transform-reference', detail: `its ${what} is not a face` };
    const found = await this.#stored(
      reference.object,
      'face',
      reference.element.index,
      reference.element.name,
    );
    if ('stop' in found) return found;
    const face = found.element as ElementFace;
    if (!inRange(face.centroid) || !(face.area > 0)) return unsound(what);
    return this.#match(
      face,
      'face',
      `its ${what} ${cleanName(reference.element.name, 'nothing')}`,
      `${reference.object}|face|${reference.element.index}`,
    );
  }

  /**
   * The flat face a loose chain's sketch can stay on (S12a): the face its support names, on a
   * feature walked before, found on the rebuilt body by S6's matcher, when the sketch's stored
   * frame lies in that face's plane (S9's datum tolerances). Anything else is no face: the sketch
   * then takes the fixed plane its stored placement gives.
   */
  async sketchFace(sketch: string): Promise<GivenPlane | undefined> {
    const { doc } = this.#c;
    const object = doc.byName.get(sketch);
    const support = object ? supportsOf(object)[0] : undefined;
    const m = support ? /^Face([1-9]\d{0,8})$/.exec(support.sub) : null;
    if (!object || !support || !m || !this.#c.walked.has(support.object)) return undefined;
    const index = Number(m[1]) - 1;
    const stored = await this.#stored(support.object, 'face', index, support.sub);
    if ('stop' in stored) return undefined;
    const face = stored.element as ElementFace;
    if (face.type !== 'plane' || !face.direction || !inRange(face.centroid)) return undefined;
    const frame = this.#frame(sketch);
    const normal = unit(face.direction);
    if (!(norm(cross(frame.n, normal)) <= SKETCH_FACE_PARALLEL)) return undefined;
    const off = Math.abs(dot(sub(frame.origin, face.centroid), normal));
    if (!(off <= SKETCH_FACE_ON + 1e-9 * norm(face.centroid))) return undefined;
    const found = await this.face(
      {
        kind: 'element',
        object: support.object,
        element: { kind: 'face', index, name: support.sub },
      },
      'face to sketch on',
    );
    if ('stop' in found) return undefined;
    return { plane: found, kind: 'face', point: face.centroid, normal };
  }

  // ------------------------------------------------------------ datums (S9)

  /**
   * A datum line or plane (`PartDesign::Line`, `PartDesign::Plane`) of this
   * body as an Extrudo reference, made once per import and before its first
   * user, in that user's transaction. The truth is the datum's stored
   * placement, moved by its containers as a sketch's is (the line through its
   * position along its local Z; the plane through it with its local Z as the
   * normal). Its attachment only chooses the construction: an origin axis or
   * plane it coincides with; a plane on an origin plane moved along that
   * plane's normal (`offsetPlane`); a line along a straight edge the matcher
   * finds or along a line of a sketch of this body (`axisAlongEdge`); else
   * fixed construction points from the placement's numbers, an axis through
   * two or a plane through three. Each construction's report must give the
   * file's line or plane after the rebuild (`checks`).
   */
  /**
   * A datum's world line or plane from its stored placement (moved by its
   * containers): its position and local Z, or why it can't be used. Nothing
   * is made.
   */
  datumGeometry(o: FcObject, what: string): { origin: Vec3; z: Vec3 } | TransformStop {
    if (o.unreadable?.includes('Placement'))
      return { stop: 'transform-reference', detail: `its ${what}'s placement can't be read` };
    if (o.properties.Placement?.value.kind !== 'placement')
      return { stop: 'transform-reference', detail: `its ${what} has no placement` };
    const g = sketchFrame(this.#c.doc, o).global;
    if (!frameIsSound(g)) return unsound(what);
    const origin = g.position as Vec3;
    const z = rotate(g.rotation, [0, 0, 1]) as Vec3;
    if (!sound(origin, z)) return unsound(what);
    return { origin, z };
  }

  async datum(
    object: string,
    want: 'line' | 'plane',
    what: string,
  ): Promise<(DatumMade & { along?: Vec3 }) | TransformStop> {
    const { doc, body } = this.#c;
    const refuse = (detail: string): TransformStop => ({ stop: 'transform-reference', detail });
    const o = doc.byName.get(object);
    if (!o) return refuse(`its ${what} ${cleanName(object, object)} isn't in the file`);
    const isLine = o.type === 'PartDesign::Line';
    if (isLine !== (want === 'line'))
      return refuse(`its ${what} is a datum ${isLine ? 'line' : 'plane'}, not a ${want}`);
    // The body's members: `Group`, or `Model` in the 0.14 builds' bodies.
    const group = (body.properties.Group ?? body.properties.Model)?.value;
    if (group?.kind !== 'linkList' || !group.objects.includes(object))
      return refuse(`its ${what} is a datum outside its body`);
    const made = this.#c.datums?.get(object);
    if (made) return made;
    if ((this.#c.datums?.size ?? 0) >= (this.#c.maxDatums ?? MAX_DATUMS))
      return {
        stop: 'limit',
        detail: `the file brings in more than ${this.#c.maxDatums ?? MAX_DATUMS} datums`,
      };
    const geometry = this.datumGeometry(o, what);
    if ('stop' in geometry) return geometry;
    const { origin, z } = geometry;
    const mode = mapModeOf(o) ?? 'unknown';
    const supports = supportsOf(o);
    const name = cleanName(o.label, o.name);
    const before = this.constructions;
    const done = (
      ref: GeomRef | TransformStop,
      how: DatumMade['how'],
      extra: { along?: Vec3 } = {},
      normal: Vec3 = z,
    ): (DatumMade & { along?: Vec3 }) | TransformStop => {
      if ('stop' in ref) return ref;
      const features: string[] = [];
      if (this.constructions > before) {
        const ids = this.#c.design.doc.features.map((f) => f.id as string);
        append(features, ids.slice(ids.length - (this.constructions - before)));
      }
      const d: DatumMade = {
        ref,
        how,
        mode,
        ...(want === 'line'
          ? { line: { origin, direction: z } }
          : { plane: { origin, normal: z }, normal }),
        features,
      };
      this.#c.datums?.set(object, d);
      this.datumsMade.push(d);
      if (features.length > 0 && (ref.kind === 'axis' || ref.kind === 'plane'))
        this.checks.push({
          feature: ref.id,
          name,
          ...(want === 'line'
            ? { line: { origin, direction: z } }
            : { plane: { origin, normal: z } }),
        });
      return { ...d, ...extra };
    };
    if (want === 'line') {
      const line: Line = { origin, direction: z };
      const axis = this.#originAxis(line);
      if (axis) return done(axis.ref, 'origin', { along: axis.along });
      if (mode === 'TwoPointLine' && supports.length === 1) {
        const [support] = supports as [{ object: string; sub: string }];
        const target = doc.byName.get(support.object);
        const edge = /^Edge([1-9]\d{0,8})$/.exec(support.sub);
        // Along a line of a sketch of this body that came in: the drawn line itself.
        if (target?.type.startsWith('Sketcher::SketchObject') && edge) {
          const index = Number(edge[1]) - 1;
          const drawn = this.#drawn({ kind: 'sketch-line', sketch: target.name, geometry: index });
          const l = this.#sketchLine(target.name, index);
          if (drawn && !('stop' in l) && collinear(l, line)) {
            const id = this.#construct(
              'axisAlongEdge',
              { edge: { kind: 'ref', refs: [drawn] } },
              name,
            );
            if (typeof id !== 'string') return id;
            return done({ kind: 'axis', id }, 'sketch-line', { along: l.direction });
          }
        } else if (target && edge && this.#c.walked.has(target.name)) {
          // Along a straight edge of a feature of this body, found on the rebuilt body.
          const found = await this.#stored(target.name, 'edge', Number(edge[1]) - 1, support.sub);
          if (!('stop' in found)) {
            const e = found.element as ElementEdge;
            const ends = e.ends as [Vec3, Vec3] | undefined;
            if (
              e.type === 'line' &&
              ends?.length === 2 &&
              norm(sub(ends[1], ends[0])) > 1e-9 &&
              collinear({ origin: ends[0], direction: unit(sub(ends[1], ends[0])) }, line)
            ) {
              const ref = await this.#match(
                e,
                'edge',
                `its ${what}'s edge`,
                `${target.name}|edge|${Number(edge[1]) - 1}`,
              );
              if ('stop' in ref) return ref;
              const id = this.#construct(
                'axisAlongEdge',
                { edge: { kind: 'ref', refs: [ref] } },
                name,
              );
              if (typeof id !== 'string') return id;
              return done({ kind: 'axis', id }, 'edge', {
                along: canonical(unit(sub(ends[1], ends[0]))),
              });
            }
          }
        }
      }
      return done(this.#axisOf(line, name), 'fixed', { along: z });
    }
    const plane: Plane = { origin, normal: z };
    const onOrigin = this.#originPlane(plane);
    if (onOrigin)
      return done(
        onOrigin,
        'origin',
        {},
        ORIGIN_PLANES.find((x) => x.id === onOrigin.id)?.frame.normal as Vec3,
      );
    if (
      mode === 'FlatFace' &&
      supports.length === 1 &&
      (supports[0] as { sub: string }).sub === ''
    ) {
      const base = doc.byName.get((supports[0] as { object: string }).object);
      // An origin plane of the feature's own body, never another body's.
      const p =
        base?.type === 'App::Plane' && ownOriginFeature(doc, body, base.name)
          ? ORIGIN_PLANES.find((x) => {
              const role = base.properties.Role?.value;
              const r = role?.kind === 'string' ? role.value : base.name;
              return r.startsWith(`${x.id.slice('origin:'.length).toUpperCase()}_Plane`);
            })
          : undefined;
      const n = p?.frame.normal as Vec3 | undefined;
      // On an origin plane of this body, moved along its normal only: Extrudo's offset plane.
      if (p && n && !this.#c.moved && norm(cross(n, z)) <= PARALLEL) {
        const id = this.#construct(
          'offsetPlane',
          {
            plane: { kind: 'ref', refs: [{ kind: 'plane', id: p.id }] },
            distance: expr(`${literal(dot(origin, n))} mm`, 'length'),
          },
          name,
        );
        if (typeof id !== 'string') return id;
        return done({ kind: 'plane', id }, 'offset', {}, n);
      }
    }
    return done(this.#planeOf(plane, name), 'fixed');
  }

  /**
   * The plane for a sketch whose frame is tilted off every origin axis (S9),
   * made in the feature's transaction: its datum plane when it is attached
   * to one of this body (section 3), else a plane through three fixed points
   * of its own frame. `undefined` when S4's planes hold the frame, or the
   * sketch came in already.
   */
  async sketchPlane(sketch: string): Promise<GivenPlane | TransformStop | undefined> {
    const { doc } = this.#c;
    if (this.#c.sketches.has(sketch)) return undefined;
    const o = doc.byName.get(sketch);
    if (!o?.type.startsWith('Sketcher::SketchObject')) return undefined;
    const g = sketchFrame(doc, o).global;
    if (!frameIsSound(g) || fitsOriginPlane(g)) return undefined;
    const n = rotate(g.rotation, [0, 0, 1]) as Vec3;
    const supports = supportsOf(o);
    const support =
      supports.length === 1
        ? doc.byName.get((supports[0] as { object: string }).object)
        : undefined;
    if (
      support?.type === 'PartDesign::Plane' &&
      (supports[0] as { sub: string }).sub === '' &&
      mapModeOf(o) === 'FlatFace'
    ) {
      // The datum's plane only when the sketch's own frame lies in it (an attachment offset
      // along the normal moves the sketch off it); else, as for any refusal of the datum that
      // isn't a kernel call's, the plane through the sketch's own frame.
      const geometry = this.datumGeometry(support, 'sketch plane');
      const inPlane =
        !('stop' in geometry) &&
        norm(cross(geometry.z, n)) <= PARALLEL &&
        Math.abs(dot(sub(g.position as Vec3, geometry.origin), geometry.z)) <=
          onTolerance(g.position as Vec3);
      if (inPlane) {
        const d = await this.datum(support.name, 'plane', 'sketch plane');
        if ('stop' in d && CALL_STOPS.has(d.stop)) return d;
        if (!('stop' in d))
          return {
            plane: d.ref,
            kind: 'datum',
            point: (d.plane as Plane).origin,
            normal: d.normal ?? n,
          };
      }
    }
    if (!sound(g.position as Vec3, n)) return unsound('sketch plane');
    const ref = this.#planeOf(
      { origin: g.position as Vec3, normal: n },
      `${cleanName(o.label, o.name)} plane`,
    );
    if ('stop' in ref) return ref;
    return { plane: ref, kind: 'points', point: g.position as Vec3, normal: n };
  }

  // ------------------------------------------------------------ external geometry (S9)

  /**
   * The external geometry a sketch's constraints name, as projections to
   * make (section 5): an edge of a feature of this body walked before (found
   * on the rebuilt body by S6's matcher, the body as it is when the sketch is
   * made) or a line of another sketch of this body that came in. The curve is
   * where FreeCAD stored its projection (1.0+), else the source projected
   * onto the sketch's plane along its normal (a line's ends, a circle whose
   * axis is the normal, an arc of one through the edge's middle). Anything else is not planned and stays out, as
   * before S9. `reversed` and `off` come from an earlier try (`bodies.ts`).
   */
  async externals(
    sketch: string,
    reversed: ReadonlySet<number>,
    off: ReadonlySet<number>,
  ): Promise<
    | { plans: Map<number, ExternalPlan>; links: number; causes: Map<number, ExternalCause> }
    | TransformStop
  > {
    const plans = new Map<number, ExternalPlan>();
    const causes = new Map<number, ExternalCause>();
    const { doc } = this.#c;
    const decoded = this.#c.sketchOf(sketch);
    const ext = decoded?.external;
    if (!decoded || !ext || this.#c.sketches.has(sketch)) return { plans, links: 0, causes };
    const o = doc.byName.get(sketch) as FcObject;
    const f = this.#frame(sketch);
    const uv = (p: Vec3): Vec2 => [dot(sub(p, f.origin), f.x), dot(sub(p, f.origin), f.y)];
    const wanted = new Set<number>();
    for (const c of decoded.constraints.slice(0, MAX_CANDIDATES))
      for (const g of c ? [c.first, c.second, c.third] : [])
        if (g <= -3 && g !== GEO_UNDEF && g > -3 - MAX_SKETCH_GEOMETRY) wanted.add(g);
    // Counted as the walk keeps projections (`used`), and here as planned for this try.
    const budget = this.#c.externalBudget;
    let planned = 0;
    let n = 0;
    for (const g of wanted) {
      if (off.has(g)) {
        causes.set(g, 'elsewhere');
        continue;
      }
      if (++n > MAX_EXTERNAL_PER_SKETCH || (budget && budget.used + planned >= budget.max)) {
        causes.set(g, 'limit');
        continue;
      }
      const k = -g - 3;
      const li = externalLinkOf(ext, k);
      const link = li === undefined ? undefined : ext.links[li];
      const stored = ext.stored?.[k]?.geometry;
      if (!link || (ext.stored && !stored)) {
        causes.set(g, 'link');
        continue;
      }
      const target = doc.byName.get(link.object);
      if (/^Vertex\d/.test(link.sub)) {
        causes.set(g, 'vertex');
        continue;
      }
      const edge = /^Edge([1-9]\d{0,8})$/.exec(link.sub);
      if (!target || !edge) {
        causes.set(g, 'source');
        continue;
      }
      let curve: FcGeometry | undefined = stored;
      let ref: GeomRef | undefined;
      let key = 'edge';
      if (target.type.startsWith('Sketcher::SketchObject')) {
        // A line of another sketch of this body that came in (ADR-0125's projection of a sketch curve).
        const index = Number(edge[1]) - 1;
        const drawn = this.#drawn({ kind: 'sketch-line', sketch: target.name, geometry: index });
        const l = this.#sketchLine(target.name, index);
        if (!drawn || 'stop' in l || target.name === o.name) {
          causes.set(g, 'sketch-line');
          continue;
        }
        ref = drawn;
        key = 'curve';
        const end = add(l.origin, scale(l.direction, this.#lineLength(target.name, index)));
        curve ??= {
          kind: 'line',
          start: uv(l.origin),
          end: uv(end),
          construction: true,
          internal: 0,
        };
      } else {
        if (!this.#c.walked.has(target.name)) {
          causes.set(g, 'source');
          continue;
        }
        const found = await this.#stored(target.name, 'edge', Number(edge[1]) - 1, link.sub);
        if ('stop' in found) {
          if (CALL_STOPS.has(found.stop)) return found;
          causes.set(g, 'stored');
          continue;
        }
        const e = found.element as ElementEdge;
        const arc =
          e.type === 'circle' &&
          e.ends?.length === 2 &&
          norm(sub(e.ends[1] as Vec3, e.ends[0] as Vec3)) > 1e-9;
        const square = !!e.direction && norm(cross(unit(e.direction), f.n)) <= PARALLEL;
        if (!curve) {
          // Before 1.0 the file stores no projection: the stored edge projected along the normal.
          if (e.type === 'line' && e.ends?.length === 2)
            curve = {
              kind: 'line',
              start: uv(e.ends[0] as Vec3),
              end: uv(e.ends[1] as Vec3),
              construction: true,
              internal: 0,
            };
          else if (e.type === 'circle' && !arc && e.centre && e.radius !== undefined && square)
            curve = {
              kind: 'circle',
              center: uv(e.centre),
              radius: e.radius,
              angleXU: 0,
              reversed: false,
              construction: true,
              internal: 0,
            };
          else if (arc && e.centre && e.radius !== undefined && square)
            // Which of the two arcs between the ends: the one through the edge's middle.
            curve = arcThrough(
              uv(e.centre),
              e.radius,
              uv(e.ends?.[0] as Vec3),
              uv(e.ends?.[1] as Vec3),
              uv(e.midpoint),
            );
        }
        if (!curve) {
          causes.set(g, 'kind');
          continue;
        }
        const r = await this.#match(
          e,
          'edge',
          `its projected ${cleanName(link.sub, 'edge')}`,
          `${target.name}|edge|${Number(edge[1]) - 1}`,
        );
        if ('stop' in r) {
          if (CALL_STOPS.has(r.stop)) return r;
          causes.set(
            g,
            /counterparts/.test(r.detail) ? 'several' : r.stop === 'reference' ? 'none' : 'stored',
          );
          continue;
        }
        ref = r;
      }
      if (curve.kind !== 'line' && curve.kind !== 'circle' && curve.kind !== 'arc') {
        causes.set(g, 'kind');
        continue;
      }
      const finite = (
        curve.kind === 'line' ? [...curve.start, ...curve.end] : [...curve.center, curve.radius]
      ).every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_FEATURE_LENGTH);
      if (!finite || (curve.kind === 'arc' && !arcFits(curve))) {
        causes.set(g, 'kind');
        continue;
      }
      planned++;
      plans.set(g, { curve, ref, key, ...(reversed.has(g) ? { reversed: true } : {}) });
    }
    return { plans, links: wanted.size, causes };
  }

  /** A sketch line's length (its ends' distance in the sketch). */
  #lineLength(sketch: string, geometry: number): number {
    const g = this.#c.sketchOf(sketch)?.geometry[geometry];
    return g?.kind === 'line' ? Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) : 0;
  }

  // ------------------------------------------------------------ the features

  async #row(r: DecodedRow, what: string) {
    const line = await this.line(r.reference, what);
    if ('stop' in line) return line;
    const sense = (dot(line.along, line.fc) < 0 ? -1 : 1) * (r.reversed ? -1 : 1);
    return {
      ref: line.ref,
      count: `${r.count}`,
      distance: `${literal(sense * r.distance)} mm`,
      measure: r.measure,
    };
  }

  async #linear(what: Repeated, first: DecodedRow, second: DecodedRow | undefined) {
    const a = await this.#row(first, 'direction');
    if ('stop' in a) return a;
    const b = second ? await this.#row(second, 'second direction') : undefined;
    if (b && 'stop' in b) return b;
    const inputs = rectangularPatternInputs({
      ...objectsOf(what),
      direction1: a.ref,
      count1: a.count,
      distance1: a.distance,
      measure1: a.measure,
      ...(b
        ? { direction2: b.ref, count2: b.count, distance2: b.distance, measure2: b.measure }
        : {}),
    });
    return this.#add('rectangularPattern', inputs);
  }

  async #polar(what: Repeated, s: Extract<DecodedStep, { kind: 'polar' }>) {
    const line = await this.line(s.reference, 'axis');
    if ('stop' in line) return line;
    const sense = (dot(line.along, line.fc) < 0 ? -1 : 1) * (s.reversed ? -1 : 1);
    // A whole turn the other way: FreeCAD spreads -360° like any angle short of a turn (the
    // last instance on the first), Extrudo like a turn; say the step instead.
    // FreeCAD takes an Extent of 360° (within 1e-7) as a whole turn and anything else over
    // count − 1 steps; Extrudo takes 360° or more either way as a turn. Where they differ (−360°,
    // the last 1e-7 short of a turn) the step is said instead.
    const fcTurn = Math.abs(s.angle - 360) < 1e-7;
    const turn = s.measure === 'total' && !fcTurn && Math.abs(s.angle) >= 360 - 1e-9;
    const angle =
      fcTurn && s.measure === 'total'
        ? 360
        : turn && s.count > 1
          ? s.angle / (s.count - 1)
          : s.angle;
    const inputs = circularPatternInputs({
      ...objectsOf(what),
      axis: line.ref,
      count: `${s.count}`,
      angle: `${literal(sense * angle)} deg`,
      measure: turn ? 'step' : s.measure,
    });
    return this.#add('circularPattern', inputs);
  }

  async #mirror(what: Repeated, s: Extract<DecodedStep, { kind: 'mirrored' }>, name?: string) {
    const plane = await this.plane(s.reference);
    if ('stop' in plane) return plane;
    const inputs =
      'features' in what
        ? mirrorInputs([], plane, { features: [...what.features] })
        : mirrorInputs([...what.bodies], plane, { copy: true, join: true });
    return this.#add('mirror', inputs, name);
  }

  #add(type: string, inputs: unknown, name?: string): { feature: string } | TransformStop {
    try {
      return {
        feature: this.#c.design.add(type as never, inputs as never, { name: name ?? this.#c.name })
          .id,
      };
    } catch (error) {
      return { stop: 'failed', detail: `Extrudo refused it: ${(error as Error).message}` };
    }
  }

  /**
   * Adds the transform's features: one, or for a MultiTransform of two
   * mirrors at right angles three (a mirror in each plane and a turn of 180°
   * about the line where they meet: the diagonal copy). Extrudo's mirror of
   * a mirror would replay only the first mirror's first tool. `what` is the
   * originals' features, or the body itself when the originals are every
   * feature it has (its first feature made the body: there is no tool to
   * replay).
   */
  async add(
    t: DecodedTransform,
    what: Repeated,
  ): Promise<{ feature: string; extra?: readonly string[] } | TransformStop> {
    if (t.kind === 'linear') return this.#linear(what, t.first, t.second);
    if (t.kind === 'polar') return this.#polar(what, t);
    if (t.kind === 'mirrored') return this.#mirror(what, t);
    const steps = t.steps;
    const [one, two] = steps as [DecodedStep, DecodedStep | undefined];
    if (steps.length === 1) return this.add({ ...t, ...one } as DecodedTransform, what);
    if (
      steps.length === 2 &&
      one.kind === 'linear' &&
      two?.kind === 'linear' &&
      !one.second &&
      !two.second
    )
      return this.#linear(what, one.first, two.first);
    if (steps.length === 2 && one.kind === 'mirrored' && two?.kind === 'mirrored') {
      const meet = this.#square(one, two);
      if ('stop' in meet) return meet;
      const first = await this.#mirror(what, one, `${this.#c.name} (1)`);
      if ('stop' in first) return first;
      const second = await this.#mirror(what, two, `${this.#c.name} (2)`);
      if ('stop' in second) return second;
      // A body mirrored with its copy fused in: the second mirror already has the diagonal.
      if ('bodies' in what) return { feature: second.feature, extra: [first.feature] };
      const axis = this.#originAxis(meet) ?? { ref: this.#axisOf(meet) };
      if ('stop' in axis.ref) return axis.ref;
      const turn = this.#add(
        'circularPattern',
        circularPatternInputs({
          ...objectsOf(what),
          axis: axis.ref,
          count: '2',
          angle: '180 deg',
          measure: 'total',
        }),
        `${this.#c.name} (3)`,
      );
      if ('stop' in turn) return turn;
      return { feature: turn.feature, extra: [first.feature, second.feature] };
    }
    return {
      stop: 'multi-transform',
      detail: `its steps are ${steps.map((s) => s.kind).join(' then ')}, a chain this importer doesn't map`,
    };
  }

  /** Two mirror planes at right angles, worked out from the file: the line where they meet. */
  #square(
    a: Extract<DecodedStep, { kind: 'mirrored' }>,
    b: Extract<DecodedStep, { kind: 'mirrored' }>,
  ): Line | TransformStop {
    const plane = (r: DecodedReference): Plane | undefined => {
      if (r.kind === 'origin-plane') {
        const n = ORIGIN_PLANES.find((p) => p.id === `origin:${r.plane}`)?.frame.normal as Vec3;
        return { origin: [0, 0, 0], normal: n };
      }
      if (r.kind === 'sketch-axis') {
        const f = this.#frame(r.sketch);
        return { origin: f.origin, normal: r.axis === 'n' ? f.n : r.axis === 'h' ? f.y : f.x };
      }
      if (r.kind === 'sketch-line') {
        const l = this.#sketchLine(r.sketch, r.geometry);
        if ('stop' in l) return undefined;
        return { origin: l.origin, normal: unit(cross(l.direction, this.#frame(r.sketch).n)) };
      }
      return undefined;
    };
    const pa = plane(a.reference);
    const pb = plane(b.reference);
    if (!pa || !pb)
      return {
        stop: 'multi-transform',
        detail: 'its two mirror planes are not both sketch or origin planes',
      };
    const na = unit(pa.normal);
    const nb = unit(pb.normal);
    if (!sound(pa.origin, na) || !sound(pb.origin, nb)) return unsound('mirror plane');
    if (!(Math.abs(dot(na, nb)) <= PARALLEL))
      return { stop: 'multi-transform', detail: 'its two mirror planes are not at right angles' };
    // Planes n·x = h square to each other meet in the line through h₁n₁ + h₂n₂ along n₁ × n₂.
    const origin = add(scale(na, dot(pa.origin, na)), scale(nb, dot(pb.origin, nb)));
    return { origin, direction: unit(cross(na, nb)) };
  }
}
