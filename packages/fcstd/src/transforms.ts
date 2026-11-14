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
import type { CallOutcome, KernelBudget } from './budget';
import type { ReferenceTally } from './dressups';
import type { DecodedReference, DecodedRow, DecodedStep, DecodedTransform } from './features';
import { rotate } from './final-shapes';
import type { ShapeElements, SubShapeAt } from './import-kernel';
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
import type { DecodedSketch } from './sketch-decode';
import { containerChain, sketchFrame } from './sketch-place';
import type { AddSketchResult } from './sketches';

type Vec3 = readonly [number, number, number];
type ImportedSketch = Extract<AddSketchResult, { imported: true }>;

interface Line {
  readonly origin: Vec3;
  /** Unit, in FreeCAD's sense. */
  readonly direction: Vec3;
}
interface Plane {
  readonly origin: Vec3;
  readonly normal: Vec3;
}

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
  /** Prefer an origin axis or plane where one coincides (tests turn it off to reach the others). */
  readonly originFirst?: boolean;
}

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

  /** The element's stored description, described by the import kernel. */
  async #stored(
    object: string,
    kind: 'edge' | 'face',
    index: number,
    name: string,
  ): Promise<
    { stored: ShapeElements; chain: readonly import('./model').FcPlacement[] } | TransformStop
  > {
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
        return stored !== undefined;
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
    return { stored: s, chain };
  }

  /** Finds a stored edge or face on the rebuilt body and returns its persistent reference. */
  async #match(
    s: ShapeElements,
    kind: 'edge' | 'face',
    what: string,
  ): Promise<GeomRef | TransformStop> {
    const { budget, mine, design } = this.#c;
    this.#matched = true;
    const point = kind === 'edge' ? (s.edges[0]?.midpoint as Vec3) : (s.faces[0]?.centroid as Vec3);
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
    const l = kind === 'edge' ? index.edge(s.edges[0] as never) : index.face(s.faces[0] as never);
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

  #point(p: Vec3, n: number): GeomRef {
    const added = this.#c.design.add(
      'constructionPoint',
      {
        x: expr(`${literal(p[0])} mm`, 'length'),
        y: expr(`${literal(p[1])} mm`, 'length'),
        z: expr(`${literal(p[2])} mm`, 'length'),
      },
      { name: `${this.#c.name} point ${n}` },
    );
    this.constructions++;
    return { kind: 'point', id: added.id };
  }

  /** An axis through two construction points: the line exactly, pointing FreeCAD's way. */
  #axisOf(line: Line): GeomRef {
    // Points 10 mm apart about the line's origin keep the numbers as given.
    const a = this.#point(line.origin, 1);
    const b = this.#point(add(line.origin, scale(line.direction, 10)), 2);
    const added = this.#c.design.add(
      'axisThroughPoints',
      { points: { kind: 'ref', refs: [a, b] } },
      { name: `${this.#c.name} axis` },
    );
    this.constructions++;
    return { kind: 'axis', id: added.id };
  }

  /** A plane through three construction points. */
  #planeOf(plane: Plane): GeomRef {
    const n = unit(plane.normal);
    // Two directions in the plane: one square to the normal's largest component.
    const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = unit(cross(n, helper));
    const v = cross(n, u);
    const p = [plane.origin, add(plane.origin, scale(u, 10)), add(plane.origin, scale(v, 10))];
    const refs = p.map((x, i) => this.#point(x, i + 1));
    const added = this.#c.design.add(
      'planeThroughPoints',
      { points: { kind: 'ref', refs } },
      { name: `${this.#c.name} plane` },
    );
    this.constructions++;
    return { kind: 'plane', id: added.id };
  }

  // ------------------------------------------------------------ references

  #originAxis(line: Line): LineRef | undefined {
    if (this.#c.originFirst === false) return undefined;
    for (const a of ORIGIN_AXES) {
      const d = a.direction as Vec3;
      if (norm(cross(d, line.direction)) > PARALLEL) continue;
      // On the axis: the line's origin has no part square to it.
      const off = sub(line.origin, scale(d, dot(line.origin, d)));
      if (norm(off) > onTolerance(line.origin)) continue;
      return { ref: { kind: 'axis', id: a.id }, along: d, fc: line.direction };
    }
    return undefined;
  }

  #originPlane(plane: Plane): GeomRef | undefined {
    if (this.#c.originFirst === false) return undefined;
    for (const p of ORIGIN_PLANES) {
      const n = p.frame.normal as Vec3;
      if (norm(cross(n, unit(plane.normal))) > PARALLEL) continue;
      if (Math.abs(dot(plane.origin, n)) > onTolerance(plane.origin)) continue;
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
      const e = found.stored.edges[0];
      if (!e || e.type !== 'line' || e.ends?.length !== 2)
        return {
          stop: 'transform-reference',
          detail: `its ${what} ${cleanName(reference.element.name, 'nothing')} is not a straight edge`,
        };
      // FreeCAD takes the line's own direction: the curve's first end to its last (FORMAT.md).
      const [a, b] = e.ends as [Vec3, Vec3];
      line = { origin: a, direction: unit(sub(b, a)) };
      const origin = this.#originAxis(line);
      if (origin) return origin;
      const ref = await this.#match(
        found.stored,
        'edge',
        `its ${what} ${cleanName(reference.element.name, 'nothing')}`,
      );
      if ('stop' in ref) return ref;
      return { ref, along: canonical(line.direction), fc: line.direction };
    }
    const origin = this.#originAxis(line);
    if (origin) return origin;
    const drawn = this.#drawn(reference);
    if (drawn) return { ref: drawn, along: line.direction, fc: line.direction };
    return { ref: this.#axisOf(line), along: line.direction, fc: line.direction };
  }

  /** A mirror plane as an Extrudo plane reference. */
  async plane(reference: DecodedReference): Promise<GeomRef | TransformStop> {
    if (reference.kind === 'origin-plane')
      return { kind: 'plane', id: `origin:${reference.plane}` };
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
      const face = found.stored.faces[0];
      if (!face || face.type !== 'plane' || !face.direction)
        return {
          stop: 'transform-reference',
          detail: `its mirror plane ${cleanName(reference.element.name, 'nothing')} is not a flat face`,
        };
      const origin = this.#originPlane({ origin: face.centroid, normal: face.direction });
      if (origin) return origin;
      return this.#match(
        found.stored,
        'face',
        `its mirror plane ${cleanName(reference.element.name, 'nothing')}`,
      );
    }
    const f = this.#frame(reference.sketch);
    const sketch = this.#c.sketches.get(reference.sketch);
    if (reference.kind === 'sketch-axis' && reference.axis === 'n') {
      const plane = { origin: f.origin, normal: f.n };
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
    const origin = this.#originPlane(plane);
    if (origin) return origin;
    const drawn = this.#drawn(reference);
    if (drawn && sketch) {
      const p = this.#c.design.planeAtAngle(
        { axis: drawn, plane: sketch.plane, angle: '90 deg' },
        { name: `${this.#c.name} plane` },
      );
      this.constructions++;
      return { kind: 'plane', id: p.id };
    }
    return this.#planeOf(plane);
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

  async #linear(features: readonly string[], first: DecodedRow, second: DecodedRow | undefined) {
    const a = await this.#row(first, 'direction');
    if ('stop' in a) return a;
    const b = second ? await this.#row(second, 'second direction') : undefined;
    if (b && 'stop' in b) return b;
    const inputs = rectangularPatternInputs({
      features,
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

  async #polar(features: readonly string[], s: Extract<DecodedStep, { kind: 'polar' }>) {
    const line = await this.line(s.reference, 'axis');
    if ('stop' in line) return line;
    const sense = (dot(line.along, line.fc) < 0 ? -1 : 1) * (s.reversed ? -1 : 1);
    // A whole turn the other way: FreeCAD spreads -360° like any angle short of a turn (the
    // last instance on the first), Extrudo like a turn; say the step instead.
    const turn = s.measure === 'total' && Math.abs(s.angle) === 360 && s.angle < 0;
    const angle = turn && s.count > 1 ? s.angle / (s.count - 1) : s.angle;
    const inputs = circularPatternInputs({
      features,
      axis: line.ref,
      count: `${s.count}`,
      angle: `${literal(sense * angle)} deg`,
      measure: turn ? 'step' : s.measure,
    });
    return this.#add('circularPattern', inputs);
  }

  async #mirror(
    features: readonly string[],
    s: Extract<DecodedStep, { kind: 'mirrored' }>,
    name?: string,
  ) {
    const plane = await this.plane(s.reference);
    if ('stop' in plane) return plane;
    return this.#add('mirror', mirrorInputs([], plane, { features: [...features] }), name);
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

  /** Adds the transform's features (one, or two mirrors for a MultiTransform). */
  async add(
    t: DecodedTransform,
    features: readonly string[],
  ): Promise<{ feature: string; extra?: readonly string[] } | TransformStop> {
    if (t.kind === 'linear') return this.#linear(features, t.first, t.second);
    if (t.kind === 'polar') return this.#polar(features, t);
    if (t.kind === 'mirrored') return this.#mirror(features, t);
    const steps = t.steps;
    const [one, two] = steps as [DecodedStep, DecodedStep | undefined];
    if (steps.length === 1) return this.add({ ...t, ...one } as DecodedTransform, features);
    if (
      steps.length === 2 &&
      one.kind === 'linear' &&
      two?.kind === 'linear' &&
      !one.second &&
      !two.second
    )
      return this.#linear(features, one.first, two.first);
    if (steps.length === 2 && one.kind === 'mirrored' && two?.kind === 'mirrored') {
      const square = await this.#square(one, two);
      if (square !== true) return square;
      // The second mirror takes the first among its features: its copy's mirror is the diagonal one.
      const first = await this.#mirror(features, one, `${this.#c.name} (1)`);
      if ('stop' in first) return first;
      const second = await this.#mirror([...features, first.feature], two, `${this.#c.name} (2)`);
      if ('stop' in second) return second;
      return { feature: second.feature, extra: [first.feature] };
    }
    return {
      stop: 'multi-transform',
      detail: `its steps are ${steps.map((s) => s.kind).join(' then ')}, a chain this importer doesn't map`,
    };
  }

  /** Two mirror planes at right angles, worked out from the file where it can. */
  async #square(
    a: Extract<DecodedStep, { kind: 'mirrored' }>,
    b: Extract<DecodedStep, { kind: 'mirrored' }>,
  ): Promise<true | TransformStop> {
    const n = (r: DecodedReference): Vec3 | undefined => {
      if (r.kind === 'origin-plane')
        return ORIGIN_PLANES.find((p) => p.id === `origin:${r.plane}`)?.frame.normal as Vec3;
      if (r.kind === 'sketch-axis') {
        const f = this.#frame(r.sketch);
        return r.axis === 'n' ? f.n : r.axis === 'h' ? f.y : f.x;
      }
      if (r.kind === 'sketch-line') {
        const l = this.#sketchLine(r.sketch, r.geometry);
        return 'stop' in l ? undefined : cross(l.direction, this.#frame(r.sketch).n);
      }
      return undefined;
    };
    const na = n(a.reference);
    const nb = n(b.reference);
    if (!na || !nb)
      return {
        stop: 'multi-transform',
        detail: 'its two mirror planes are not both sketch or origin planes',
      };
    if (Math.abs(dot(unit(na), unit(nb))) > PARALLEL)
      return { stop: 'multi-transform', detail: 'its two mirror planes are not at right angles' };
    return true;
  }
}
