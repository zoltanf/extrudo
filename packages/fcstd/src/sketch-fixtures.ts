/**
 * Sketch objects written by hand for the tests, in FreeCAD's grammar for
 * `Geometry` and `Constraints` (each version's construction flag), built into
 * `.FCStd` bytes with `fixtures.ts`. No part of any real file.
 */
import { documentXml, type FixtureObject, fcstd, label, links, placement, prop } from './fixtures';

/** How a curve's construction flag is written: ≤0.18 (`legacy`), 0.19–0.21 (`extension`), 1.0+ (`both`). */
export type FlagForm = 'legacy' | 'extension' | 'both';

export interface CurveOptions {
  construction?: boolean;
  form?: FlagForm;
  /** `internalGeometryType` (needs an extension form). */
  internal?: number;
}

const f = (v: number) => v.toFixed(16);

function geometry(type: string, curve: string, o: CurveOptions = {}): string {
  const form = o.form ?? 'both';
  const c = o.construction === true;
  const flags = `${'0'.repeat(30)}${c ? '1' : '0'}0`;
  const ext =
    form === 'legacy'
      ? ''
      : `<GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="${o.internal ?? 0}" geometryModeFlags="${flags}" geometryLayer="0"/></GeoExtensions>`;
  // 1.0+ also writes the old element, after the curve, always 0 for old readers' sake.
  const legacy =
    form === 'legacy'
      ? `<Construction value="${c ? 1 : 0}"/>`
      : form === 'both'
        ? `<Construction value="0"/>`
        : '';
  return form === 'legacy'
    ? `<Geometry type="${type}">${legacy}${curve}</Geometry>`
    : `<Geometry type="${type}">${ext}${curve}${legacy}</Geometry>`;
}

export const line = (x1: number, y1: number, x2: number, y2: number, o?: CurveOptions) =>
  geometry(
    'Part::GeomLineSegment',
    `<LineSegment StartX="${f(x1)}" StartY="${f(y1)}" StartZ="0" EndX="${f(x2)}" EndY="${f(y2)}" EndZ="0"/>`,
    o,
  );

export const circle = (cx: number, cy: number, r: number, o?: CurveOptions) =>
  geometry(
    'Part::GeomCircle',
    `<Circle CenterX="${f(cx)}" CenterY="${f(cy)}" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="0" Radius="${f(r)}"/>`,
    o,
  );

/** An arc counter-clockwise from `start` to `end` (radians), or about a downward normal (`reversed`). */
export const arc = (
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  o: CurveOptions & { reversed?: boolean; angleXU?: number } = {},
) =>
  geometry(
    'Part::GeomArcOfCircle',
    `<ArcOfCircle CenterX="${f(cx)}" CenterY="${f(cy)}" CenterZ="0" NormalX="0" NormalY="0" NormalZ="${o.reversed ? -1 : 1}" AngleXU="${f(o.angleXU ?? 0)}" Radius="${f(r)}" StartAngle="${f(start)}" EndAngle="${f(end)}"/>`,
    o,
  );

export const point = (x: number, y: number, o?: CurveOptions) =>
  geometry('Part::GeomPoint', `<GeomPoint X="${f(x)}" Y="${f(y)}" Z="0"/>`, o);

export const ellipse = (cx: number, cy: number, major: number, minor: number, o?: CurveOptions) =>
  geometry(
    'Part::GeomEllipse',
    `<Ellipse CenterX="${f(cx)}" CenterY="${f(cy)}" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" MajorRadius="${f(major)}" MinorRadius="${f(minor)}" AngleXU="0"/>`,
    o,
  );

export const bspline = (
  poles: [number, number][],
  knots: [number, number][],
  degree: number,
  o: CurveOptions & { periodic?: boolean; weights?: number[]; polesCount?: number } = {},
) =>
  geometry(
    'Part::GeomBSplineCurve',
    `<BSplineCurve PolesCount="${o.polesCount ?? poles.length}" KnotsCount="${knots.length}" Degree="${degree}" IsPeriodic="${o.periodic ? 1 : 0}">${poles
      .map(([x, y], i) => `<Pole X="${f(x)}" Y="${f(y)}" Z="0" Weight="${o.weights?.[i] ?? 1}"/>`)
      .join(
        '',
      )}${knots.map(([v, m]) => `<Knot Value="${v}" Mult="${m}"/>`).join('')}</BSplineCurve>`,
    o,
  );

export interface ConstraintSpec {
  type: number;
  first?: number;
  firstPos?: number;
  second?: number;
  secondPos?: number;
  third?: number;
  thirdPos?: number;
  value?: number | string;
  name?: string;
  driving?: boolean;
  active?: boolean;
}

/** One `<Constrain>` record (absent indices are FreeCAD's `GeoUndef`). */
export const constraint = (c: ConstraintSpec) =>
  `<Constrain Name="${c.name ?? ''}" Type="${c.type}" Value="${c.value ?? 0}" First="${c.first ?? -2000}" FirstPos="${c.firstPos ?? 0}" Second="${c.second ?? -2000}" SecondPos="${c.secondPos ?? 0}" Third="${c.third ?? -2000}" ThirdPos="${c.thirdPos ?? 0}" LabelDistance="10" LabelPosition="0" IsDriving="${c.driving === false ? 0 : 1}" IsInVirtualSpace="0" IsActive="${c.active === false ? 0 : 1}"/>`;

/** FreeCAD constraint types by name. */
export const T = {
  coincident: 1,
  horizontal: 2,
  vertical: 3,
  parallel: 4,
  tangent: 5,
  distance: 6,
  distanceX: 7,
  distanceY: 8,
  angle: 9,
  perpendicular: 10,
  radius: 11,
  equal: 12,
  pointOnObject: 13,
  symmetric: 14,
  internalAlignment: 15,
  diameter: 18,
} as const;

export interface SketchSpec {
  name?: string;
  geometry: string[];
  constraints?: string[];
  /** The stored placement: position, angle (radians) and axis. */
  placement?: [number, number, number, number?, [number, number, number]?];
  expressions?: { path: string; expression: string }[];
}

export function sketchObject(s: SketchSpec): FixtureObject {
  const name = s.name ?? 'Sketch';
  const [x, y, z, angle, axis] = s.placement ?? [0, 0, 0];
  const constraints = s.constraints ?? [];
  return {
    name,
    type: 'Sketcher::SketchObject',
    props: [
      label(name),
      placement(x, y, z, angle ?? 0, axis ?? [0, 0, 1]),
      prop(
        'Geometry',
        'Part::PropertyGeometryList',
        `<GeometryList count="${s.geometry.length}">${s.geometry.join('\n')}</GeometryList>`,
      ),
      prop(
        'Constraints',
        'Sketcher::PropertyConstraintList',
        `<ConstraintList count="${constraints.length}">${constraints.join('\n')}</ConstraintList>`,
      ),
      ...(s.expressions
        ? [
            prop(
              'ExpressionEngine',
              'App::PropertyExpressionEngine',
              `<ExpressionEngine count="${s.expressions.length}">${s.expressions
                .map((e) => `<Expression path="${e.path}" expression="${e.expression}"/>`)
                .join('')}</ExpressionEngine>`,
            ),
          ]
        : []),
    ],
  };
}

/** A body at `at` (moved by `angle` about `axis`) holding the sketches. */
export function bodyObject(
  members: string[],
  at: [number, number, number, number?, [number, number, number]?],
): FixtureObject {
  return {
    name: 'Body',
    type: 'PartDesign::Body',
    extensions: ['App::OriginGroupExtension'],
    props: [
      label('Body'),
      placement(at[0], at[1], at[2], at[3] ?? 0, at[4] ?? [0, 0, 1]),
      links('Group', members),
    ],
  };
}

/** A file holding these objects (sketches and containers), as a given FreeCAD version saved it. */
export function sketchFile(objects: FixtureObject[], version = '1.0.0R39109 (Git)'): Uint8Array {
  return fcstd({ 'Document.xml': documentXml(objects, { version }) });
}
