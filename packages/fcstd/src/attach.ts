/**
 * FreeCAD's attachment (`Part::AttachExtension`) as the importer reads it
 * (ADR-0144 S9): a sketch's or datum's `MapMode` and its supports. The
 * stored `Placement` is always the attacher's result at save time, so the
 * geometry is taken from it; the mode only says which Extrudo construction
 * expresses that placement best (`datums.ts`).
 */
import type { FcObject } from './model';

/**
 * `Attacher::eMapMode` by its stored index (FORMAT.md): the numbers are what
 * FreeCAD writes into files and never change. The last three exist only in
 * builds after 1.1.
 */
export const MAP_MODES: readonly string[] = [
  'Deactivated',
  'Translate',
  'ObjectXY',
  'ObjectXZ',
  'ObjectYZ',
  'FlatFace',
  'TangentPlane',
  'NormalToEdge',
  'FrenetNB',
  'FrenetTN',
  'FrenetTB',
  'Concentric',
  'SectionOfRevolution',
  'ThreePointsPlane',
  'ThreePointsNormal',
  'Folding',
  'ObjectX',
  'ObjectY',
  'ObjectZ',
  'AxisOfCurvature',
  'Directrix1',
  'Directrix2',
  'Asymptote1',
  'Asymptote2',
  'Tangent',
  'Normal',
  'Binormal',
  'TangentU',
  'TangentV',
  'TwoPointLine',
  'IntersectionLine',
  'ProximityLine',
  'ObjectOrigin',
  'Focus1',
  'Focus2',
  'OnEdge',
  'CenterOfCurvature',
  'CenterOfMass',
  'IntersectionPoint',
  'Vertex',
  'ProximityPoint1',
  'ProximityPoint2',
  'AxisOfInertia1',
  'AxisOfInertia2',
  'AxisOfInertia3',
  'InertialCS',
  'FaceNormal',
  'OZX',
  'OZY',
  'OXY',
  'OXZ',
  'OYZ',
  'OYX',
  'ParallelPlane',
  'MidPoint',
  'MidPlane',
];

/**
 * An object's map mode by name: the stored index looked up in
 * {@link MAP_MODES}, or the file's own list when it writes one. A file from
 * before attachment modes (≤0.16) with a support is `FlatFace`, without one
 * `Deactivated`. `undefined` for a value that is no mode.
 */
export function mapModeOf(o: FcObject): string | undefined {
  const v = o.properties.MapMode?.value;
  if (v === undefined) return supportsOf(o).length > 0 ? 'FlatFace' : 'Deactivated';
  if (v.kind === 'enum') {
    const listed = v.values?.[v.index];
    if (listed !== undefined) return listed.replace(/^\?/, '');
    return Number.isInteger(v.index) ? MAP_MODES[v.index] : undefined;
  }
  if (v.kind === 'integer') return Number.isInteger(v.value) ? MAP_MODES[v.value] : undefined;
  return undefined;
}

/** The most supports one attachment may list (FreeCAD's modes take at most four). */
export const MAX_SUPPORTS = 16;

/** An attachment's supports (`AttachmentSupport`, or `Support` before 1.0): object and element, in order, at most `MAX_SUPPORTS + 1`. */
export function supportsOf(o: FcObject): { object: string; sub: string }[] {
  const v = o.properties.AttachmentSupport?.value ?? o.properties.Support?.value;
  if (!v) return [];
  const out: { object: string; sub: string }[] = [];
  if (v.kind === 'linkSubList') {
    for (const l of v.items) {
      if (out.length > MAX_SUPPORTS) break;
      out.push({ object: l.object, sub: l.sub.name });
    }
  } else if (v.kind === 'linkSub' && v.object) {
    for (const s of v.subs.length > 0 ? v.subs : [{ name: '' }]) {
      if (out.length > MAX_SUPPORTS) break;
      out.push({ object: v.object, sub: s.name });
    }
  }
  return out;
}
