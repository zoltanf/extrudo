/**
 * `d.sketch(plane, build, options?)`: a sketch feature and the `SketchBuilder`
 * that fills it (ADR-0068 §5).
 *
 * ```ts
 * const s = d.sketch(d.origin.xy, (k) => {
 *   const plate = k.rectangle([0, 0], [40, 20]);
 *   k.circle([10, 10], '3 mm');
 *   k.dimension(plate.bottom, '40 mm', { name: 'width' });
 * });
 * d.extrude({ profiles: s.profileAt([1, 1]), distance: '10 mm' });
 * ```
 *
 * The entities, constraints and dimensions come from `@extrudo/sketch/build`,
 * the builders the drawing tools use too, so what a script draws and what the
 * Rectangle tool draws are the same stored thing. **Nothing is solved**: the
 * positions are stored as given, as in a sketch the app opens and solves (the
 * solver needs planegcs, which the API keeps out, ADR-0068 §1). Profile IDs
 * don't depend on positions (ADR-0020), so a later solve keeps them.
 */
import {
  type ConstraintId,
  type DimensionId,
  type GeomRef,
  profileRefId,
  readSketch,
  type SketchArc,
  type SketchCircle,
  type SketchConstraint,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
  type SketchLine,
  sketchEntityRefId,
  type Vec2,
} from '@extrudo/core';
import {
  addArc,
  addCircle,
  addDimension,
  addEllipse,
  addLine,
  addPoint,
  addSpline,
  addText,
  type BuildIds,
  constrainOne,
  emptyAdd,
  type PolygonShape,
  polygonAround,
  polygonEdit,
  polygonOnEdge,
  rectangleEdit,
  type SketchAdd,
  slotEdit,
  slotShape,
  type TextContent,
} from '@extrudo/sketch/build';
import { detectProfiles, insidePolygon, type Profile, profileAt } from '@extrudo/sketch/profiles';
import type { FeatureOptions } from './design';
import { ApiError } from './error';
import { FeatureHandle, ParameterHandle } from './handles';

export type { TextContent };

/** What a sketch is built from, and what else goes into it. */
export interface SketchOptions extends FeatureOptions {
  /** Every new curve is construction geometry (the app's X toggle). */
  construction?: boolean;
}

/** What a dimension drives with: an expression, a number in mm or degrees, or a parameter. */
export type DimValue = string | number | ParameterHandle;

/** How a distance dimension reads (ADR-0004's orientations). */
export type DimensionOrientation = 'aligned' | 'horizontal' | 'vertical';

/** What a dimension may carry besides its value. */
export interface DimensionOptions {
  /**
   * The model parameter's name (ADR-0016): a driving dimension shows up as one,
   * `d1` by default. A name is what expressions and the customizer use, so
   * `d.setParameter('width', '40 mm')`… no: a dimension's own value is edited
   * through the dimension, not the parameter.
   */
  name?: string;
  /** Measure the geometry instead of driving it (a reference dimension). */
  driven?: boolean;
}

/** What a call may name an entity by: the handle the builder returned, or its ID. */
export type EntityLike = SketchEntityHandle | string;

/** The entity ID behind whatever the caller named. */
function idOf(entity: EntityLike): SketchEntityId {
  return typeof entity === 'string' ? (entity as SketchEntityId) : entity.id;
}

// Handles ------------------------------------------------------------------------

/** One entity of a sketch: its ID, the sketch it is in, and what it is referenced as. */
export class SketchEntityHandle {
  readonly id: SketchEntityId;
  /** The sketch this entity belongs to. */
  readonly sketch: SketchHandle;

  constructor(sketch: SketchHandle, id: SketchEntityId) {
    this.sketch = sketch;
    this.id = id;
  }

  /**
   * The entity as a reference: `sketchEntity:<sketch>/<entity>` (ADR-0068 §4).
   * An extrude takes a curve or a point here, a hole takes sketch points, and a
   * face field takes a point; a text's whole text is its own ID (ADR-0058 §5).
   */
  ref(): GeomRef {
    return { kind: 'sketchEntity', id: sketchEntityRefId(this.sketch.id, this.id) };
  }

  /** The stored entity, or `undefined` when it is gone. */
  get entity(): SketchEntity | undefined {
    return this.sketch.data.entities[this.id];
  }

  /** Where it is, for a point; `undefined` for a curve. */
  position(): Vec2 | undefined {
    const entity = this.entity;
    return entity?.type === 'point' ? [entity.x, entity.y] : undefined;
  }
}

/** A point: where it is, and what a constraint or dimension can hold it to. */
export class PointHandle extends SketchEntityHandle {
  /** The point's position in sketch mm. */
  at(): Vec2 {
    return this.position() as Vec2;
  }
}

/** A line, with its own two points. */
export class LineHandle extends SketchEntityHandle {
  readonly start: PointHandle;
  readonly end: PointHandle;

  constructor(sketch: SketchHandle, id: SketchEntityId, start: PointHandle, end: PointHandle) {
    super(sketch, id);
    this.start = start;
    this.end = end;
  }
}

/** A circle, with its centre. */
export class CircleHandle extends SketchEntityHandle {
  readonly center: PointHandle;

  constructor(sketch: SketchHandle, id: SketchEntityId, center: PointHandle) {
    super(sketch, id);
    this.center = center;
  }
}

/** An arc, with its centre and the two ends in the order they were drawn. */
export class ArcHandle extends SketchEntityHandle {
  readonly center: PointHandle;
  readonly start: PointHandle;
  readonly end: PointHandle;

  constructor(
    sketch: SketchHandle,
    id: SketchEntityId,
    center: PointHandle,
    start: PointHandle,
    end: PointHandle,
  ) {
    super(sketch, id);
    this.center = center;
    this.start = start;
    this.end = end;
  }
}

/** An ellipse (ADR-0014): three points, no numbers stored. */
export class EllipseHandle extends SketchEntityHandle {
  readonly center: PointHandle;
  readonly major: PointHandle;
  readonly minor: PointHandle;

  constructor(
    sketch: SketchHandle,
    id: SketchEntityId,
    center: PointHandle,
    major: PointHandle,
    minor: PointHandle,
  ) {
    super(sketch, id);
    this.center = center;
    this.major = major;
    this.minor = minor;
  }
}

/** A spline (ADR-0014, ADR-0063): fit points, control poles or a conic's three points. */
export class SplineHandle extends SketchEntityHandle {
  readonly points: PointHandle[];

  constructor(sketch: SketchHandle, id: SketchEntityId, points: PointHandle[]) {
    super(sketch, id);
    this.points = points;
  }
}

/** A text (ADR-0058): the anchor on its baseline and the point a height above it. */
export class TextHandle extends SketchEntityHandle {
  readonly anchor: PointHandle;
  readonly top: PointHandle;

  constructor(sketch: SketchHandle, id: SketchEntityId, anchor: PointHandle, top: PointHandle) {
    super(sketch, id);
    this.anchor = anchor;
    this.top = top;
  }
}

/** Several lines joined end to end: the points along it and the lines between them. */
export class PolylineHandle {
  /** The sketch the chain is in. */
  readonly sketch: SketchHandle;
  readonly lines: LineHandle[];
  /** The `lines.length + 1` points, first to last. */
  readonly points: PointHandle[];

  constructor(sketch: SketchHandle, lines: LineHandle[]) {
    this.sketch = sketch;
    this.lines = lines;
    const first = lines[0];
    this.points = first ? [first.start, ...lines.map((line) => line.end)] : [];
  }
}

/** A rectangle: its four edges in drawing order and the corner each edge starts at. */
export class RectangleHandle {
  readonly sketch: SketchHandle;
  /** The four edges, `bottom` first, going counter-clockwise. */
  readonly edges: [LineHandle, LineHandle, LineHandle, LineHandle];
  /** The four corners, each the start of an edge. */
  readonly corners: [PointHandle, PointHandle, PointHandle, PointHandle];
  /** The centre point, for a rectangle built from its centre. */
  readonly center?: PointHandle;

  constructor(
    sketch: SketchHandle,
    edges: [LineHandle, LineHandle, LineHandle, LineHandle],
    center?: PointHandle,
  ) {
    this.sketch = sketch;
    this.edges = edges;
    this.corners = edges.map((edge) => edge.start) as [
      PointHandle,
      PointHandle,
      PointHandle,
      PointHandle,
    ];
    if (center) this.center = center;
  }

  /** The edge from the first corner to the second, along +x for an axis-aligned one. */
  get bottom(): LineHandle {
    return this.edges[0] as LineHandle;
  }
  /** The edge from the second corner to the third, along +y. */
  get right(): LineHandle {
    return this.edges[1] as LineHandle;
  }
  /** The edge from the third corner back to the fourth. */
  get top(): LineHandle {
    return this.edges[2] as LineHandle;
  }
  /** The edge from the fourth corner back to the first. */
  get left(): LineHandle {
    return this.edges[3] as LineHandle;
  }
}

/** A slot (ADR-0014): two straight sides, two half circles and its construction centreline. */
export class SlotHandle {
  readonly sketch: SketchHandle;
  /** The two straight sides. */
  readonly lines: [LineHandle, LineHandle];
  /** The two half circles. */
  readonly arcs: [ArcHandle, ArcHandle];
  readonly centerline: LineHandle;

  constructor(
    sketch: SketchHandle,
    lines: [LineHandle, LineHandle],
    arcs: [ArcHandle, ArcHandle],
    centerline: LineHandle,
  ) {
    this.sketch = sketch;
    this.lines = lines;
    this.arcs = arcs;
    this.centerline = centerline;
  }
}

/** A regular polygon: its edges, its corners and the construction circle through them. */
export class PolygonHandle {
  readonly sketch: SketchHandle;
  readonly edges: LineHandle[];
  /** The corners, each the start of an edge. */
  readonly corners: PointHandle[];
  /** The construction circle through the corners (ADR-0014). */
  readonly circle: CircleHandle;

  constructor(sketch: SketchHandle, edges: LineHandle[], circle: CircleHandle) {
    this.sketch = sketch;
    this.edges = edges;
    this.corners = edges.map((edge) => edge.start);
    this.circle = circle;
  }
}

/** A dimension: what it measures and the model parameter it shows up under. */
export class DimensionHandle {
  readonly id: DimensionId;
  readonly sketch: SketchHandle;

  constructor(sketch: SketchHandle, id: DimensionId) {
    this.sketch = sketch;
    this.id = id;
  }

  /** The stored dimension, or `undefined` when it is gone. */
  get dimension(): SketchDimension | undefined {
    return this.sketch.data.dimensions[this.id];
  }

  /** Its model parameter's name (`d1`, or the name the call gave), if it drives. */
  get parameterName(): string | undefined {
    return this.dimension?.paramName;
  }

  /** The expression it drives with. */
  get expr(): string {
    return this.dimension?.expr ?? '';
  }
}

/**
 * A sketch feature: its plane, its content, and the profile references built
 * from them (`s.profiles()`, `s.profileAt([x, y])`, ADR-0068 §4).
 */
export class SketchHandle extends FeatureHandle<'sketch'> {
  /** What a `d.sketch` call is collecting, until it is stored (`Design.sketch` sets it). */
  #collecting: (() => SketchData) | undefined;

  /**
   * Makes this handle read what the build call is collecting instead of the
   * document, so a constraint or dimension on an entity the same call made can
   * tell a line from a circle. `Design.sketch` sets it and clears it again.
   */
  collect(read: (() => SketchData) | undefined): void {
    this.#collecting = read;
  }

  /** The sketch's points, curves, constraints and dimensions. */
  get data(): SketchData {
    const collecting = this.#collecting;
    if (collecting) return collecting();
    const feature = this.feature;
    return (
      (feature && readSketch(feature)?.data) || { entities: {}, constraints: {}, dimensions: {} }
    );
  }

  /** The plane the sketch is drawn on: an origin or construction plane, or a flat face. */
  get plane(): GeomRef | undefined {
    const feature = this.feature;
    return feature ? readSketch(feature)?.plane : undefined;
  }

  /** The regions this sketch holds, with their holes (ADR-0020). */
  get regions(): Profile[] {
    return detectProfiles(this.data);
  }

  /** Every region this sketch holds, as `profile` references. */
  profiles(): GeomRef[] {
    return this.regions.map((region) => this.#regionRef(region));
  }

  /**
   * The region at a point, as a reference for an extrude's profiles. Refused
   * where no region is (`profileOrUndefined` says so without throwing), since a
   * profile the caller picked is what the design needs.
   */
  profileAt(point: Vec2): GeomRef {
    const region = this.profileOrUndefined(point);
    if (!region) {
      throw new ApiError(
        `The sketch has no profile at (${point[0]}, ${point[1]}) mm: nothing is drawn there.`,
      );
    }
    return region;
  }

  /** The region at a point, or `undefined` where the sketch is empty there. */
  profileOrUndefined(point: Vec2): GeomRef | undefined {
    const region = profileAt(this.regions, point);
    return region ? this.#regionRef(region) : undefined;
  }

  /**
   * The regions wholly inside a polygon, as references — what an extrude of
   * "every profile in here" needs. A point on the boundary counts as inside,
   * so a region drawn exactly to the polygon's own corners is in it.
   */
  profilesInside(polygon: readonly Vec2[]): GeomRef[] {
    const within = (p: Vec2) => insidePolygon(polygon, p) || onBoundary(polygon, p);
    const inside = (region: Profile) =>
      [...region.outer.polygon, ...region.holes.flatMap((hole) => hole.polygon)].every(within);
    return this.regions.filter(inside).map((region) => this.#regionRef(region));
  }

  /** The handle of one entity, by its ID. */
  entity(id: SketchEntityId): SketchEntityHandle {
    return new SketchEntityHandle(this, id);
  }

  /** The sketch's points, in the order they were added. */
  points(): PointHandle[] {
    return this.#each('point').map(([id]) => new PointHandle(this, id));
  }

  /** The sketch's lines, in the order they were added. */
  lines(): LineHandle[] {
    return this.#each('line').map(([id, entity]) => {
      const line = entity as SketchLine;
      return new LineHandle(
        this,
        id,
        new PointHandle(this, line.start),
        new PointHandle(this, line.end),
      );
    });
  }

  /** The sketch's circles, in the order they were added. */
  circles(): CircleHandle[] {
    return this.#each('circle').map(([id, entity]) => {
      const circle = entity as SketchCircle;
      return new CircleHandle(this, id, new PointHandle(this, circle.center));
    });
  }

  /** The sketch's arcs, in the order they were added. */
  arcs(): ArcHandle[] {
    return this.#each('arc').map(([id, entity]) => {
      const arc = entity as SketchArc;
      return new ArcHandle(
        this,
        id,
        new PointHandle(this, arc.center),
        new PointHandle(this, arc.start),
        new PointHandle(this, arc.end),
      );
    });
  }

  /** Every entity of one kind, as `[id, entity]` in the order they were added. */
  #each(type: SketchEntity['type']): [SketchEntityId, SketchEntity][] {
    return Object.entries(this.data.entities)
      .filter(([, entity]) => entity.type === type)
      .map(([id, entity]) => [id as SketchEntityId, entity]);
  }

  #regionRef(region: Profile): GeomRef {
    return { kind: 'profile', id: profileRefId(this.id, region.id) };
  }
}

// Builder -----------------------------------------------------------------------

/**
 * What a sketch's `build` function gets: the entities, the constraints and the
 * dimensions of one sketch (ADR-0068 §5). Everything a call adds goes into one
 * change, which becomes the sketch's content in one undo step.
 */
export class SketchBuilder {
  /** The sketch being built, for its handles and profile references. */
  readonly sketch: SketchHandle;
  readonly #edit: SketchAdd;
  readonly #ids: BuildIds;

  constructor(sketch: SketchHandle, edit: SketchAdd, ids: BuildIds) {
    this.sketch = sketch;
    this.#edit = edit;
    this.#ids = ids;
  }

  /** What the sketch holds so far. */
  get data(): SketchData {
    return {
      entities: this.#edit.entities,
      constraints: this.#edit.constraints,
      dimensions: this.#edit.dimensions,
    };
  }

  // Entities --------------------------------------------------------------------

  /** A point on its own. */
  point(at: Vec2): PointHandle {
    return new PointHandle(this.sketch, addPoint(this.#edit, this.#ids, at));
  }

  /** A line with its own two points, from `a` to `b`. */
  line(a: Vec2, b: Vec2): LineHandle {
    return this.#line(addLine(this.#edit, this.#ids, a, b));
  }

  /**
   * A chain of lines joined end to end. Each point belongs to one curve
   * (ADR-0010), so every joint is a coincident constraint, which this adds.
   */
  polyline(points: readonly Vec2[]): PolylineHandle {
    if (points.length < 2) throw new ApiError('A polyline needs at least two points.');
    const lines = points.slice(1).map((p, i) => this.line(points[i] as Vec2, p));
    for (let i = 0; i < lines.length - 1; i++) {
      this.coincident(lines[i]?.end as PointHandle, lines[i + 1]?.start as PointHandle);
    }
    return new PolylineHandle(this.sketch, lines as LineHandle[]);
  }

  /**
   * A rectangle between two opposite corners, as the 2-point tool draws it:
   * four lines joined at their corners, horizontal and vertical. The sides keep
   * the order the corners were given in, so the second is the far one.
   */
  rectangle(a: Vec2, b: Vec2): RectangleHandle {
    if (a[0] === b[0] || a[1] === b[1]) {
      throw new ApiError('A rectangle needs two corners that differ in both x and y.');
    }
    return new RectangleHandle(this.sketch, this.#rectangleEdges([a, b]));
  }

  /**
   * A rectangle from its centre and one corner, with the two construction
   * diagonals that hold the centre in the middle (the Centre tool).
   */
  rectangleCentered(center: Vec2, corner: Vec2): RectangleHandle {
    const dx = Math.abs(corner[0] - center[0]);
    const dy = Math.abs(corner[1] - center[1]);
    if (dx < 1e-9 || dy < 1e-9) {
      throw new ApiError('A rectangle needs a corner away from its centre in both x and y.');
    }
    const a: Vec2 = [center[0] - dx, center[1] - dy];
    const c: Vec2 = [center[0] + dx, center[1] + dy];
    const made = rectangleEdit(
      this.#edit,
      this.#ids,
      [a, [c[0], a[1]], c, [a[0], c[1]]],
      'centre',
      center,
    );
    return new RectangleHandle(
      this.sketch,
      made.edges.map((edge) => this.#line(edge)) as [
        LineHandle,
        LineHandle,
        LineHandle,
        LineHandle,
      ],
      made.center ? new PointHandle(this.sketch, made.center) : undefined,
    );
  }

  /** A circle of `radius` mm about `center`. */
  circle(center: Vec2, radius: number | string): CircleHandle {
    const made = addCircle(this.#edit, this.#ids, center, mmOf(radius));
    return new CircleHandle(this.sketch, made.id, new PointHandle(this.sketch, made.center));
  }

  /**
   * An arc through three points, `start` to `end` counter-clockwise about the
   * circle they lie on (the 3-point tool). The three must not be collinear.
   */
  arc(start: Vec2, end: Vec2, through: Vec2): ArcHandle {
    const circle = circleThrough(start, end, through);
    if (!circle) throw new ApiError('An arc through three points: these three have no circle.');
    return this.#arc(
      circle.center,
      circle.radius,
      angleOf(circle.center, start),
      angleOf(circle.center, end),
      false,
    );
  }

  /**
   * An arc about a known centre: from `start` counter-clockwise to `end`, or
   * clockwise when `reversed` says so (the schema stores arcs counter-clockwise,
   * so a clockwise arc's stored start is `end`).
   */
  arcCentered(
    center: Vec2,
    start: Vec2,
    end: Vec2,
    options: { reversed?: boolean } = {},
  ): ArcHandle {
    const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
    if (radius < 1e-9) throw new ApiError('An arc needs a start away from its centre.');
    return this.#arc(
      center,
      radius,
      angleOf(center, start),
      angleOf(center, end),
      options.reversed === true,
    );
  }

  /**
   * An ellipse from three points: the centre, the end of the major axis and the
   * end of the minor one (ADR-0014). Nothing is stored but the points — the
   * solver keeps the minor end square to the major axis — so equal radii would
   * be a circle, which is refused.
   */
  ellipse(center: Vec2, major: Vec2, minor: Vec2): EllipseHandle {
    const a = Math.hypot(major[0] - center[0], major[1] - center[1]);
    const b = Math.hypot(minor[0] - center[0], minor[1] - center[1]);
    if (a - b < 1e-6 * Math.max(a, b)) {
      throw new ApiError('An ellipse needs two different radii; equal ones are a circle.');
    }
    const made = addEllipse(this.#edit, this.#ids, center, major, minor);
    return new EllipseHandle(
      this.sketch,
      made.id,
      new PointHandle(this.sketch, made.center),
      new PointHandle(this.sketch, made.major),
      new PointHandle(this.sketch, made.minor),
    );
  }

  /**
   * A regular polygon whose corners lie on a circle (the Inscribed tool): `sides`
   * equal lines, every corner on a construction circle, 4 degrees of freedom
   * (position, size, rotation). `{ mode: 'circumscribed' }` takes `corner` as the
   * middle of the first edge and sizes the polygon across the flats instead (a
   * nut's wrench size).
   */
  polygon(
    center: Vec2,
    corner: Vec2,
    sides = 6,
    options: { mode?: 'inscribed' | 'circumscribed' } = {},
  ): PolygonHandle {
    if (sides < 3 || sides > 64) {
      throw new ApiError(`A polygon has 3 to 64 sides, not ${sides}.`);
    }
    const mode = options.mode ?? 'inscribed';
    const reach = Math.hypot(corner[0] - center[0], corner[1] - center[1]);
    if (reach < 1e-9) throw new ApiError('A polygon needs a corner away from its centre.');
    const angle = Math.atan2(corner[1] - center[1], corner[0] - center[0]);
    const shape =
      mode === 'inscribed'
        ? polygonAround(center, reach, angle, sides)
        : polygonAround(center, reach / Math.cos(Math.PI / sides), angle - Math.PI / sides, sides);
    return this.#polygon(shape, mode);
  }

  /** A regular polygon on one edge, on the side of `side` (the Edge tool). */
  polygonOnEdge(a: Vec2, b: Vec2, side: Vec2, sides = 6): PolygonHandle {
    if (sides < 3 || sides > 64) {
      throw new ApiError(`A polygon has 3 to 64 sides, not ${sides}.`);
    }
    const shape = polygonOnEdge(a, b, side, sides);
    if (!shape) throw new ApiError('A polygon needs an edge of its own and 3 or more sides.');
    return this.#polygon(shape, 'inscribed');
  }

  /**
   * A slot between two points: `centers` (the default) takes the two arc
   * centres, `overall` the two ends of the slot (the Slot tool's two modes).
   * `width` is the distance between the straight sides.
   */
  slot(
    a: Vec2,
    b: Vec2,
    width: number,
    options: { mode?: 'centers' | 'overall' } = {},
  ): SlotHandle {
    const overall = (options.mode ?? 'centers') === 'overall';
    const shape = slotShape(a, b, width / 2, overall);
    if (!shape) {
      throw new ApiError(
        overall
          ? 'The slot is wider than it is long, so its ends would cross.'
          : 'A slot needs two different centres and a positive width.',
      );
    }
    const made = slotEdit(this.#edit, this.#ids, shape, overall ? 'ends' : 'centers');
    return new SlotHandle(
      this.sketch,
      [this.#line(made.outline.lineA), this.#line(made.outline.lineB)],
      [this.#arcHandle(made.outline.arc1), this.#arcHandle(made.outline.arc2)],
      this.#line(made.centerline),
    );
  }

  /** A spline through `points` (ADR-0014): a smooth curve through every one. */
  spline(points: readonly Vec2[]): SplineHandle {
    return this.#spline(points, 'fit');
  }

  /** A spline guided by its points as B-spline poles (ADR-0063). */
  splineControl(points: readonly Vec2[]): SplineHandle {
    return this.#spline(points, 'control');
  }

  /**
   * A conic: exactly three points — `start`, the `shoulder` where the end
   * tangents meet, and `end` — and `rho`, how full it is (ADR-0063): below 0.5
   * an ellipse arc, 0.5 a parabola, above a hyperbola arc.
   */
  conic(start: Vec2, shoulder: Vec2, end: Vec2, rho: number): SplineHandle {
    return this.#spline([start, shoulder, end], 'conic', rho);
  }

  /**
   * A text (ADR-0058), sized and turned by its two points: `anchor` on the first
   * line's baseline, `top` one text height above it. The height is the font's cap
   * height and the baseline runs 90° clockwise from `top − anchor`. It gets the
   * upright constraint and the height dimension the Text tool adds, so the height
   * is a dimension (and a parameter) like any other.
   */
  text(anchor: Vec2, top: Vec2, content: TextContent): TextHandle {
    const made = addText(this.#edit, this.#ids, anchor, top, content);
    const start = new PointHandle(this.sketch, made.anchor);
    const up = new PointHandle(this.sketch, made.top);
    this.vertical(start, up);
    this.dimension([start, up], `${mmLength(top, anchor)} mm`);
    return new TextHandle(this.sketch, made.id, start, up);
  }

  // Constraints -----------------------------------------------------------------

  /** Two points are the same point (ADR-0010: curves that meet join their ends). */
  coincident(a: EntityLike, b: EntityLike): ConstraintId {
    return this.#constraint({ type: 'coincident', a: idOf(a), b: idOf(b) });
  }

  /** A point lies on a line, circle, arc or ellipse. */
  pointOnCurve(point: EntityLike, curve: EntityLike): ConstraintId {
    return this.#constraint({ type: 'pointOnCurve', point: idOf(point), curve: idOf(curve) });
  }

  collinear(a: EntityLike, b: EntityLike): ConstraintId {
    return this.#constraint({ type: 'collinear', a: idOf(a), b: idOf(b) });
  }

  concentric(a: EntityLike, b: EntityLike): ConstraintId {
    return this.#constraint({ type: 'concentric', a: idOf(a), b: idOf(b) });
  }

  /** A point is the middle of a line or arc. */
  midpoint(point: EntityLike, of: EntityLike): ConstraintId {
    return this.#constraint({ type: 'midpoint', point: idOf(point), of: idOf(of) });
  }

  /** An entity stays where it is (a projected curve, or geometry to solve around). */
  fix(entity: EntityLike): ConstraintId {
    return this.#constraint({ type: 'fix', entity: idOf(entity) });
  }

  parallel(a: EntityLike, b: EntityLike): ConstraintId {
    return this.#constraint({ type: 'parallel', a: idOf(a), b: idOf(b) });
  }

  perpendicular(a: EntityLike, b: EntityLike): ConstraintId {
    return this.#constraint({ type: 'perpendicular', a: idOf(a), b: idOf(b) });
  }

  /** A line is level, or two points at the same height. */
  horizontal(a: EntityLike, b?: EntityLike): ConstraintId {
    return this.#constraint({
      type: 'horizontal',
      a: idOf(a),
      ...(b === undefined ? {} : { b: idOf(b) }),
    });
  }

  /** A line is upright, or two points on the same upright. */
  vertical(a: EntityLike, b?: EntityLike): ConstraintId {
    return this.#constraint({
      type: 'vertical',
      a: idOf(a),
      ...(b === undefined ? {} : { b: idOf(b) }),
    });
  }

  /** A curve runs on into another one; `reversed` says whether they meet head to head. */
  tangent(a: EntityLike, b: EntityLike, reversed = false): ConstraintId {
    return this.#constraint({ type: 'tangent', a: idOf(a), b: idOf(b), reversed });
  }

  /** As `tangent`, and the two curves share their tangent at the joint. */
  smooth(a: EntityLike, b: EntityLike, reversed = false): ConstraintId {
    return this.#constraint({ type: 'smooth', a: idOf(a), b: idOf(b), reversed });
  }

  /** Two lines are as long as each other, or two circles or arcs as round. */
  equal(a: EntityLike, b: EntityLike): ConstraintId {
    return this.#constraint({ type: 'equal', a: idOf(a), b: idOf(b) });
  }

  /** Two entities mirror each other across a line (ADR-0019's Mirror). */
  symmetric(a: EntityLike, b: EntityLike, axis: EntityLike): ConstraintId {
    return this.#constraint({ type: 'symmetric', a: idOf(a), b: idOf(b), axis: idOf(axis) });
  }

  // Dimensions ------------------------------------------------------------------

  /**
   * A dimension, and what it measures follows what it is given (as the Dimension
   * tool works it out, P1-07):
   *
   * - a line: its length; a circle: its diameter; an arc: its radius;
   * - two points: their distance, `orientation` saying aligned, horizontal or
   *   vertical; a point and a line: the point's distance to it;
   * - two lines: the angle between them.
   *
   * `{ name }` gives the model parameter the dimension shows up as a name of its
   * own (`d1` otherwise); that name is what expressions use (ADR-0016). A
   * dimension is stored as an expression, so `wall`, `'2 * wall'` and `'30 mm'`
   * are all values it can take.
   */
  dimension(
    target: EntityLike | readonly [EntityLike, EntityLike],
    value: DimValue,
    options: DimensionOptions & { orientation?: DimensionOrientation } = {},
  ): DimensionHandle {
    const targets = (Array.isArray(target) ? target : [target]) as readonly EntityLike[];
    const first = this.entity(targets[0] as EntityLike);
    const second = targets[1] === undefined ? undefined : this.entity(targets[1] as EntityLike);
    if (!second) {
      const kind = first.entity?.type;
      if (kind === 'circle') return this.diameter(first, value, options);
      if (kind === 'arc') return this.radius(first, value, options);
      return this.distance(first, value, options);
    }
    if (first.entity?.type === 'line' && second.entity?.type === 'line') {
      return this.angle(first, second, value, options);
    }
    return this.distance([first, second], value, options);
  }

  /** A distance: a line's length (`target` alone), or two entities' apart. */
  distance(
    target: EntityLike | readonly [EntityLike, EntityLike],
    value: DimValue,
    options: DimensionOptions & { orientation?: DimensionOrientation } = {},
  ): DimensionHandle {
    const targets = (Array.isArray(target) ? target : [target]) as readonly EntityLike[];
    return this.#add(
      {
        type: 'distance',
        orientation: options.orientation ?? 'aligned',
        a: idOf(targets[0] as EntityLike),
        ...(targets[1] === undefined ? {} : { b: idOf(targets[1] as EntityLike) }),
      },
      value,
      options,
    );
  }

  /** A circle's or an arc's radius. */
  radius(curve: EntityLike, value: DimValue, options: DimensionOptions = {}): DimensionHandle {
    return this.#add({ type: 'radius', curve: idOf(curve) }, value, options);
  }

  /** A circle's diameter. */
  diameter(curve: EntityLike, value: DimValue, options: DimensionOptions = {}): DimensionHandle {
    return this.#add({ type: 'diameter', curve: idOf(curve) }, value, options);
  }

  /**
   * The angle between two lines, 0 to 180°; `supplement` picks the other pair
   * of angles where they cross.
   */
  angle(
    a: EntityLike,
    b: EntityLike,
    value: DimValue,
    options: DimensionOptions & { supplement?: boolean } = {},
  ): DimensionHandle {
    return this.#add(
      {
        type: 'angle',
        a: idOf(a),
        b: idOf(b),
        ...(options.supplement === undefined ? {} : { supplement: options.supplement }),
      },
      value,
      options,
    );
  }

  /**
   * A reference dimension: it measures the geometry and follows it, instead of
   * driving it (the Dimension tool's driven state, P1-08).
   */
  reference(
    target: EntityLike | readonly [EntityLike, EntityLike],
    value: DimValue,
    options: { orientation?: DimensionOrientation } = {},
  ): DimensionHandle {
    return this.dimension(target, value, { ...options, driven: true });
  }

  // Internals ------------------------------------------------------------------

  /** The handle of an entity already in this sketch, by its ID or handle. */
  entity(entity: EntityLike): SketchEntityHandle {
    if (typeof entity !== 'string') return entity;
    if (!(entity in this.#edit.entities)) {
      throw new ApiError(`This sketch has no entity "${entity}".`);
    }
    return new SketchEntityHandle(this.sketch, entity as SketchEntityId);
  }

  #constraint(constraint: SketchConstraint): ConstraintId {
    return constrainOne(this.#edit, this.#ids, constraint, false);
  }

  #add(
    dimension: SketchDimensionInput,
    value: DimValue,
    options: DimensionOptions,
  ): DimensionHandle {
    const id = addDimension(this.#edit, this.#ids, {
      ...dimension,
      expr: exprOf(value),
      driven: options.driven === true,
      ...(options.name === undefined ? {} : { paramName: options.name }),
    });
    return new DimensionHandle(this.sketch, id);
  }

  #line(line: { id: SketchEntityId; start: SketchEntityId; end: SketchEntityId }): LineHandle {
    return new LineHandle(
      this.sketch,
      line.id,
      new PointHandle(this.sketch, line.start),
      new PointHandle(this.sketch, line.end),
    );
  }

  #arcHandle(arc: {
    id: SketchEntityId;
    center: SketchEntityId;
    first: SketchEntityId;
    last: SketchEntityId;
  }): ArcHandle {
    return new ArcHandle(
      this.sketch,
      arc.id,
      new PointHandle(this.sketch, arc.center),
      new PointHandle(this.sketch, arc.first),
      new PointHandle(this.sketch, arc.last),
    );
  }

  #arc(center: Vec2, radius: number, from: number, to: number, reversed: boolean): ArcHandle {
    return this.#arcHandle(
      addArc(this.#edit, this.#ids, {
        center,
        radius,
        from,
        sweep: counterClockwise(from, to),
        reversed,
      }),
    );
  }

  #spline(points: readonly Vec2[], mode: 'fit' | 'control' | 'conic', rho?: number): SplineHandle {
    const made = addSpline(this.#edit, this.#ids, points, mode, rho);
    return new SplineHandle(
      this.sketch,
      made.id,
      made.points.map((point) => new PointHandle(this.sketch, point)),
    );
  }

  /** The four edges of a rectangle between two opposite corners, counter-clockwise. */
  #rectangleEdges(
    corners: readonly [Vec2, Vec2],
  ): [LineHandle, LineHandle, LineHandle, LineHandle] {
    const c: Vec2 = [corners[1][0], corners[0][1]];
    return rectangleEdit(
      this.#edit,
      this.#ids,
      [corners[0], c, corners[1], [corners[0][0], corners[1][1]]],
      'aligned',
    ).edges.map((edge) => this.#line(edge)) as [LineHandle, LineHandle, LineHandle, LineHandle];
  }

  #polygon(shape: PolygonShape, mode: 'inscribed' | 'circumscribed'): PolygonHandle {
    const made = polygonEdit(this.#edit, this.#ids, shape, mode);
    return new PolygonHandle(
      this.sketch,
      made.edges.map((edge) => this.#line(edge)),
      new CircleHandle(
        this.sketch,
        made.circle.id,
        new PointHandle(this.sketch, made.circle.center),
      ),
    );
  }
}

/** A dimension to store: what it measures, with its value and name to fill in. */
export type SketchDimensionInput = DistributiveOmit<SketchDimension, 'expr' | 'driven'> & {
  expr?: string;
  driven?: boolean;
  paramName?: string;
};

/** `Omit` over a union, keeping every kind of dimension (TS's own is not distributive). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Whether a point is on a polygon's outline, within `ON_EDGE` (mm): the even-odd test says no. */
function onBoundary(polygon: readonly Vec2[], p: Vec2): boolean {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j] as Vec2;
    const b = polygon[i] as Vec2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const cross = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
    const along = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len);
    if (cross <= 1e-6 && along >= -1e-9 && along <= 1 + 1e-9) return true;
  }
  return false;
}

/** What a dimension stores for its expression: `wall`, `'2 * wall'`, `'30 mm'` or `30`. */
function exprOf(value: DimValue): string {
  return value instanceof ParameterHandle
    ? value.name
    : typeof value === 'number'
      ? String(value)
      : value;
}

/** A length in mm as a stored number: `'3 mm'` and `3` are both fine, an expression is not. */
function mmOf(value: number | string): number {
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed) && /^\s*-?[\d.]+/.test(value)) return parsed;
  throw new ApiError(
    `A stored radius needs a number of millimetres, not "${value}": dimension the circle instead.`,
  );
}

/** The distance between two points, rounded so a stored expression reads well. */
function mmLength(a: Vec2, b: Vec2): number {
  return Number(Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(6));
}

/** The angle of a point round a centre, radians counter-clockwise from +x. */
function angleOf(center: Vec2, p: Vec2): number {
  return Math.atan2(p[1] - center[1], p[0] - center[0]);
}

/** The counter-clockwise angle from one angle to another, 0 to 2π. */
function counterClockwise(from: number, to: number): number {
  const sweep = (to - from) % (2 * Math.PI);
  return sweep < 0 ? sweep + 2 * Math.PI : sweep;
}

/** The circle through three points, or `undefined` when they are collinear. */
function circleThrough(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number } | undefined {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const cx = c[0] - a[0];
  const cy = c[1] - a[1];
  const d = 2 * (bx * cy - by * cx);
  const scale = Math.max(bx * bx + by * by, cx * cx + cy * cy);
  if (scale === 0 || Math.abs(d) < 1e-9 * scale) return undefined;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  return { center: [a[0] + ux, a[1] + uy], radius: Math.hypot(ux, uy) };
}

/** The edit one `d.sketch` call collects into, with the design's ID factory. */
export function newSketchEdit(
  mint: (kind: 'sketchEntity' | 'constraint' | 'dimension') => string,
  construction: boolean,
): { edit: SketchAdd; ids: BuildIds } {
  const edit = emptyAdd();
  return {
    edit,
    ids: { newId: () => mint('sketchEntity'), construction: () => construction },
  };
}
