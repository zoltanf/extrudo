/**
 * A sketch object's raw `Geometry` and `Constraints` records (`model.ts`
 * keeps them as the file has them) as typed data. Nothing is mapped here:
 * coordinates stay in the sketch's own frame (mm), angles in radians, and
 * every index stays the file's, since constraints name geometry by position
 * and expressions name constraints by position.
 *
 * Every number goes through `finite`. A record that can't be read becomes
 * `undefined` in its slot, with a problem; a sketch past a limit is not
 * decoded at all (`overLimit`). The format as read is in `FORMAT.md`.
 */
import { FcstdFormatError, finite, short } from './errors';
import type { FcObject, FcRecord } from './model';

export type Vec2 = readonly [number, number];

/** At most this many geometry records per sketch (the library's largest has 28). */
export const MAX_SKETCH_GEOMETRY = 10_000;
/** At most this many constraint records per sketch (the library's largest has 71). */
export const MAX_SKETCH_CONSTRAINTS = 20_000;
/** At most this many poles per B-spline (the library's have 3). */
export const MAX_BSPLINE_POLES = 1_000;

/** `GeoUndef`: an unused geometry slot of a constraint. */
export const GEO_UNDEF = -2000;
/** The sketch's horizontal axis (and, with point position 1, its origin). */
export const H_AXIS = -1;
/** The sketch's vertical axis. */
export const V_AXIS = -2;

interface GeoBase {
  /** Construction geometry (never part of a profile). */
  readonly construction: boolean;
  /**
   * The internal-alignment role (`internalGeometryType`): 0 none, 1–8
   * ellipse, hyperbola and parabola parts, 9 a B-spline pole circle, 10 a
   * B-spline knot point, 11 a parabola's focal axis.
   */
  readonly internal: number;
}

/** A conic's own frame in the sketch: FreeCAD's `AngleXU` and which way its normal points. */
interface Conic {
  readonly center: Vec2;
  /** `AngleXU`, radians (0 when absent, as in files before 0.17). */
  readonly angleXU: number;
  /** The normal points down (−Z): the curve runs clockwise in the sketch. */
  readonly reversed: boolean;
}

export type FcGeometry =
  | (GeoBase & { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 })
  | (GeoBase & Conic & { readonly kind: 'circle'; readonly radius: number })
  | (GeoBase &
      Conic & {
        readonly kind: 'arc';
        readonly radius: number;
        /** Parameter angles about the arc's own frame, radians; `end > start`. */
        readonly startAngle: number;
        readonly endAngle: number;
      })
  | (GeoBase & { readonly kind: 'point'; readonly at: Vec2 })
  | (GeoBase & {
      readonly kind: 'bspline';
      readonly degree: number;
      readonly periodic: boolean;
      readonly poles: readonly Vec2[];
      readonly weights: readonly number[];
      /** Distinct knot values with their multiplicities, as stored (not normalised). */
      readonly knots: readonly number[];
      readonly multiplicities: readonly number[];
    })
  | (GeoBase &
      Conic & {
        readonly kind: 'ellipse' | 'arcOfEllipse';
        readonly majorRadius: number;
        readonly minorRadius: number;
        /** Arcs only: eccentric-anomaly parameters, radians. */
        readonly startAngle?: number;
        readonly endAngle?: number;
      })
  /** Anything else (hyperbola, parabola, an infinite line, a type of a later version). */
  | (GeoBase & { readonly kind: 'other'; readonly type: string });

export interface FcConstraint {
  /** `ConstraintType`: 1 Coincident … 19 Weight (`FORMAT.md`). */
  readonly type: number;
  /** Geometry indices (`First`, `Second`, `Third`): ≥ 0 the sketch's, −1/−2 the axes, ≤ −3 external, −2000 unused. */
  readonly first: number;
  readonly second: number;
  readonly third: number;
  /** Point positions: 0 the curve, 1 start, 2 end, 3 centre. */
  readonly firstPos: number;
  readonly secondPos: number;
  readonly thirdPos: number;
  /** mm for lengths, radians for angles; encoded for point-wise tangents and perpendiculars. */
  readonly value: number;
  readonly name: string;
  /** `false` for a reference (driven) dimension. */
  readonly driving: boolean;
  /** `false` when the solver ignores it. */
  readonly active: boolean;
  readonly virtualSpace: boolean;
  /** Type 15 only: `InternalAlignmentType` and `InternalAlignmentIndex`. */
  readonly alignment?: { readonly type: number; readonly index: number };
}

export interface DecodedSketch {
  /** One slot per stored record, in the file's order; `undefined` where the record couldn't be read. */
  readonly geometry: readonly (FcGeometry | undefined)[];
  readonly constraints: readonly (FcConstraint | undefined)[];
  /** Set when the sketch breaks a limit: nothing else is decoded then. */
  readonly overLimit?: string;
  /** What couldn't be read, one line each. */
  readonly problems: readonly string[];
}

const SKETCH_EXTENSION = 'Sketcher::SketchGeometryExtension';

const num = (what: string, a: Readonly<Record<string, string>>, key: string, fallback?: number) => {
  const v = finite(`${what} ${key}`, a[key]);
  if (v !== undefined) return v;
  if (fallback !== undefined) return fallback;
  throw new FcstdFormatError(`${what}: ${key} is missing.`);
};

/** An integer attribute within ±2³¹ (a geometry index, a position, a type). */
const int = (what: string, a: Readonly<Record<string, string>>, key: string, fallback?: number) => {
  const v = num(what, a, key, fallback);
  if (!Number.isInteger(v) || Math.abs(v) > 2 ** 31)
    throw new FcstdFormatError(`${what}: ${key} ${short(String(a[key]))} is not an index.`);
  return v;
};

const flag = (text: string | undefined, fallback: boolean) =>
  text === undefined ? fallback : text === '1' || text === 'true';

/** The construction flag and internal role, by the version's form (`FORMAT.md`). */
function base(what: string, r: FcRecord): GeoBase {
  const extensions = r.children.find((c) => c.tag === 'GeoExtensions');
  const sketcher = extensions?.children.find(
    (c) => c.tag === 'GeoExtension' && c.attrs.type === SKETCH_EXTENSION,
  );
  const legacy = r.children.find((c) => c.tag === 'Construction');
  let construction = flag(legacy?.attrs.value, false);
  let internal = 0;
  if (sketcher) {
    // 0.19+: a bit string, the rightmost character bit 0 (blocked), bit 1 construction.
    const bits = sketcher.attrs.geometryModeFlags;
    if (bits !== undefined && /^[01]{2,64}$/.test(bits))
      construction = bits[bits.length - 2] === '1';
    internal = int(what, sketcher.attrs, 'internalGeometryType', 0);
  }
  return { construction, internal };
}

/** The element of a record holding its curve (the first child that isn't an extension or a flag). */
function curveElement(r: FcRecord): FcRecord | undefined {
  return r.children.find(
    (c) => c.tag !== 'GeoExtensions' && c.tag !== 'Construction' && c.tag !== 'UID',
  );
}

function conic(what: string, a: Readonly<Record<string, string>>): Conic {
  const nz = num(what, a, 'NormalZ', 1);
  const nx = num(what, a, 'NormalX', 0);
  const ny = num(what, a, 'NormalY', 0);
  // A sketch's curves lie in its plane: a normal off ±Z is not one of them.
  if (Math.abs(nx) > 1e-9 || Math.abs(ny) > 1e-9 || Math.abs(Math.abs(nz) - 1) > 1e-9)
    throw new FcstdFormatError(`${what}: its normal is not the sketch's.`);
  return {
    center: [num(what, a, 'CenterX'), num(what, a, 'CenterY')],
    angleXU: num(what, a, 'AngleXU', 0),
    reversed: nz < 0,
  };
}

const positive = (what: string, v: number, name: string) => {
  if (!(v > 0)) throw new FcstdFormatError(`${what}: its ${name} is not positive.`);
  return v;
};

function geometryOf(what: string, r: FcRecord): FcGeometry {
  const type = r.attrs.type ?? '';
  const b = base(what, r);
  const e = curveElement(r);
  const a = e?.attrs ?? {};
  switch (type) {
    case 'Part::GeomLineSegment':
      if (e?.tag !== 'LineSegment') break;
      return {
        ...b,
        kind: 'line',
        start: [num(what, a, 'StartX'), num(what, a, 'StartY')],
        end: [num(what, a, 'EndX'), num(what, a, 'EndY')],
      };
    case 'Part::GeomCircle':
      if (e?.tag !== 'Circle') break;
      return {
        ...b,
        ...conic(what, a),
        kind: 'circle',
        radius: positive(what, num(what, a, 'Radius'), 'radius'),
      };
    case 'Part::GeomArcOfCircle': {
      if (e?.tag !== 'ArcOfCircle') break;
      const startAngle = num(what, a, 'StartAngle');
      const endAngle = num(what, a, 'EndAngle');
      const sweep = endAngle - startAngle;
      if (!(sweep > 1e-12 && sweep < 2 * Math.PI - 1e-12))
        throw new FcstdFormatError(`${what}: its angles make no arc.`);
      return {
        ...b,
        ...conic(what, a),
        kind: 'arc',
        radius: positive(what, num(what, a, 'Radius'), 'radius'),
        startAngle,
        endAngle,
      };
    }
    case 'Part::GeomPoint':
      if (e?.tag !== 'GeomPoint') break;
      return { ...b, kind: 'point', at: [num(what, a, 'X'), num(what, a, 'Y')] };
    case 'Part::GeomBSplineCurve':
      if (e?.tag !== 'BSplineCurve') break;
      return bspline(what, b, e);
    case 'Part::GeomEllipse':
    case 'Part::GeomArcOfEllipse': {
      const arc = type === 'Part::GeomArcOfEllipse';
      if (e?.tag !== (arc ? 'ArcOfEllipse' : 'Ellipse')) break;
      return {
        ...b,
        ...conic(what, a),
        kind: arc ? 'arcOfEllipse' : 'ellipse',
        majorRadius: positive(what, num(what, a, 'MajorRadius'), 'major radius'),
        minorRadius: positive(what, num(what, a, 'MinorRadius'), 'minor radius'),
        ...(arc
          ? { startAngle: num(what, a, 'StartAngle'), endAngle: num(what, a, 'EndAngle') }
          : {}),
      };
    }
    default:
      return { ...b, kind: 'other', type: short(type) };
  }
  throw new FcstdFormatError(`${what}: a ${short(type)} without its curve.`);
}

function bspline(what: string, b: GeoBase, e: FcRecord): FcGeometry {
  const a = e.attrs;
  const count = int(what, a, 'PolesCount');
  if (count > MAX_BSPLINE_POLES)
    throw new FcstdFormatError(`${what}: ${count} poles, over the limit of ${MAX_BSPLINE_POLES}.`);
  const poles: Vec2[] = [];
  const weights: number[] = [];
  const knots: number[] = [];
  const multiplicities: number[] = [];
  for (const c of e.children) {
    if (c.tag === 'Pole') {
      if (poles.length >= MAX_BSPLINE_POLES)
        throw new FcstdFormatError(`${what}: more poles than the limit of ${MAX_BSPLINE_POLES}.`);
      poles.push([num(what, c.attrs, 'X'), num(what, c.attrs, 'Y')]);
      weights.push(num(what, c.attrs, 'Weight', 1));
    } else if (c.tag === 'Knot') {
      if (knots.length > MAX_BSPLINE_POLES + 6)
        throw new FcstdFormatError(`${what}: more knots than its poles can have.`);
      knots.push(num(what, c.attrs, 'Value'));
      multiplicities.push(int(what, c.attrs, 'Mult'));
    }
  }
  const degree = int(what, a, 'Degree');
  if (poles.length !== count || knots.length !== int(what, a, 'KnotsCount', knots.length))
    throw new FcstdFormatError(`${what}: its pole or knot list doesn't match its counts.`);
  if (degree < 1 || degree >= Math.max(2, poles.length + 1))
    throw new FcstdFormatError(`${what}: degree ${degree} doesn't suit ${poles.length} poles.`);
  return {
    ...b,
    kind: 'bspline',
    degree,
    periodic: flag(a.IsPeriodic, false),
    poles,
    weights,
    knots,
    multiplicities,
  };
}

function constraintOf(what: string, r: FcRecord): FcConstraint {
  const a = r.attrs;
  const type = int(what, a, 'Type');
  const alignment =
    type === 15 && a.InternalAlignmentType !== undefined
      ? {
          type: int(what, a, 'InternalAlignmentType'),
          index: int(what, a, 'InternalAlignmentIndex', -1),
        }
      : undefined;
  return {
    type,
    // The three legacy attributes come first whenever both forms are there (1.1+ writes both).
    first: int(what, a, 'First', GEO_UNDEF),
    firstPos: int(what, a, 'FirstPos', 0),
    second: int(what, a, 'Second', GEO_UNDEF),
    secondPos: int(what, a, 'SecondPos', 0),
    third: int(what, a, 'Third', GEO_UNDEF),
    thirdPos: int(what, a, 'ThirdPos', 0),
    value: num(what, a, 'Value', 0),
    name: a.Name ?? '',
    driving: flag(a.IsDriving, true),
    active: flag(a.IsActive, true),
    virtualSpace: flag(a.IsInVirtualSpace, false),
    ...(alignment ? { alignment } : {}),
  };
}

/** The raw records of one of a sketch's list properties. */
function records(o: FcObject, property: string, kind: 'geometry' | 'constraints') {
  const v = o.properties[property]?.value;
  return v?.kind === kind ? v.records : [];
}

/**
 * Decodes a sketch object's geometry and constraints. Linear in the records;
 * a sketch over {@link MAX_SKETCH_GEOMETRY} or {@link MAX_SKETCH_CONSTRAINTS}
 * is refused whole (`overLimit`).
 */
export function decodeSketch(o: FcObject): DecodedSketch {
  const g = records(o, 'Geometry', 'geometry');
  const c = records(o, 'Constraints', 'constraints');
  const problems: string[] = [];
  if (g.length > MAX_SKETCH_GEOMETRY)
    return {
      geometry: [],
      // One empty slot per record, so each still gets an outcome.
      constraints: new Array<undefined>(c.length).fill(undefined),
      problems,
      overLimit: `${g.length} curves, over the limit of ${MAX_SKETCH_GEOMETRY}`,
    };
  if (c.length > MAX_SKETCH_CONSTRAINTS)
    return {
      geometry: [],
      // One empty slot per record, so each still gets an outcome.
      constraints: new Array<undefined>(c.length).fill(undefined),
      problems,
      overLimit: `${c.length} constraints, over the limit of ${MAX_SKETCH_CONSTRAINTS}`,
    };
  const read = <T>(list: readonly FcRecord[], noun: string, f: (what: string, r: FcRecord) => T) =>
    list.map((r, i) => {
      const what = `${o.name} ${noun} ${i}`;
      try {
        return f(what, r);
      } catch (error) {
        if (!(error instanceof FcstdFormatError)) throw error;
        problems.push(`${error.message} It was left out.`);
        return undefined;
      }
    });
  return {
    geometry: read(g, 'curve', geometryOf),
    constraints: read(c, 'constraint', constraintOf),
    problems,
  };
}
