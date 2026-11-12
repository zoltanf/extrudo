/**
 * Where a FreeCAD sketch goes in Extrudo (ADR-0144 decision 8, S4): its frame
 * is the stored `Placement`, which is always the attacher's result at save
 * time, in the coordinates of its container, times the placements of the
 * containers that move what they hold (a body, a part, ...). No support face
 * is looked up.
 *
 * Extrudo places a sketch on a plane, so the frame becomes one of the planes
 * the API offers: an origin plane, an origin plane moved along its normal,
 * or a plane turned about an origin axis (and moved). The 2D map takes
 * FreeCAD's sketch coordinates to that plane's; it mirrors when FreeCAD's
 * normal points against the plane's. A frame none of them holds (a plane
 * tilted off every origin axis) gets no plane, never a guessed one.
 */
import type { Design } from '@extrudo/api';
import {
  faceSketchFrame,
  type GeomRef,
  ORIGIN_AXES,
  ORIGIN_PLANES,
  type SketchFrame,
} from '@extrudo/core';
import { linkedObjects, rotate } from './final-shapes';
import type { FcDocument, FcObject, FcPlacement, Vec3 } from './model';
import type { Vec2 } from './sketch-decode';

/** What kind of Extrudo plane a sketch took. */
export type PlaneKind = 'origin' | 'offset' | 'angle' | 'angle-offset';

export interface SketchPlacement {
  readonly plane: GeomRef;
  readonly kind: PlaneKind;
  /** FreeCAD sketch (u, v), mm → Extrudo sketch (x, y), mm. */
  readonly map: (u: number, v: number) => Vec2;
  /** The map turns the sketch over: FreeCAD's normal is against the plane's. */
  readonly mirrored: boolean;
  /**
   * How FreeCAD's sketch axes land in Extrudo's: on the same axes (`same`,
   * signs aside), swapped (`swap`), or turned off both (`rotated`, where
   * horizontal and vertical have no counterpart).
   */
  readonly axes: 'same' | 'swap' | 'rotated';
  /** The Extrudo plane's frame in world coordinates. */
  readonly frame: SketchFrame;
  /** FreeCAD's sketch frame in world coordinates (its containers' placements applied). */
  readonly global: FcPlacement;
}

export interface SketchFrameOf {
  /** The sketch's frame in world coordinates. */
  readonly global: FcPlacement;
  /** How many containers move what they hold (any placement, identity included). */
  readonly containers: number;
  /** Some container's placement is not the identity. */
  readonly moved: boolean;
}

/** Containers whose placement applies to what they hold (the same list as `final-shapes.ts`). */
const GEO_GROUPS = new Set([
  'App::Part',
  'PartDesign::Body',
  'App::Origin',
  'App::LocalCoordinateSystem',
  'PartDesign::Boolean',
  'Assembly::AssemblyObject',
]);
const MAX_CONTAINER_DEPTH = 64;
/** How far off an axis a normal may be and still count as along it (a cosine). */
const EPS = 1e-9;

const identity: FcPlacement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

const isGeoGroup = (o: FcObject) =>
  GEO_GROUPS.has(o.type) ||
  o.extensions.some(
    (e) => e.endsWith('GeoFeatureGroupExtension') || e.endsWith('OriginGroupExtension'),
  );

/** Each object's container, built once per document. */
const parents = new WeakMap<FcDocument, Map<string, FcObject>>();
function parentsOf(doc: FcDocument): Map<string, FcObject> {
  let parent = parents.get(doc);
  if (parent) return parent;
  parent = new Map();
  for (const o of doc.objects)
    for (const key of ['Group', 'Model']) {
      const v = o.properties[key]?.value;
      if (v?.kind !== 'linkList') continue;
      for (const m of linkedObjects(v)) if (m !== o.name && !parent.has(m)) parent.set(m, o);
    }
  parents.set(doc, parent);
  return parent;
}

/** `a · b`: `b` first, then `a`. */
export function compose(a: FcPlacement, b: FcPlacement): FcPlacement {
  const [ax, ay, az, aw] = a.rotation;
  const [bx, by, bz, bw] = b.rotation;
  const t = rotate(a.rotation, b.position);
  const q: [number, number, number, number] = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
  const n = Math.hypot(...q) || 1;
  return {
    position: [t[0] + a.position[0], t[1] + a.position[1], t[2] + a.position[2]],
    rotation: q.map((v) => v / n) as unknown as FcPlacement['rotation'],
  };
}

const placementOf = (o: FcObject): FcPlacement | undefined => {
  const v = o.properties.Placement?.value;
  return v?.kind === 'placement' ? v.value : undefined;
};

const isIdentity = (p: FcPlacement) =>
  Math.hypot(...p.position) <= 1e-12 && Math.abs(Math.abs(p.rotation[3]) - 1) <= 1e-15;

/**
 * The placements of the containers that move what `object` holds, outermost
 * first (plain folders pass through), and whether one of them moves it: the
 * chain a stored shape of `object` is placed by in world coordinates, and
 * that a sketch's frame is flattened with. `undefined` for containers that
 * hold each other in a loop.
 */
export function containerChain(
  doc: FcDocument,
  object: FcObject,
): { readonly chain: FcPlacement[]; readonly moved: boolean } | undefined {
  const parent = parentsOf(doc);
  const inner: FcPlacement[] = [];
  const seen = new Set<string>([object.name]);
  for (let p = parent.get(object.name), depth = 0; p; p = parent.get(p.name), depth++) {
    if (seen.has(p.name) || depth >= MAX_CONTAINER_DEPTH) return undefined;
    seen.add(p.name);
    if (isGeoGroup(p)) inner.push(placementOf(p) ?? identity);
  }
  const chain = inner.reverse();
  return { chain, moved: chain.some((c) => !isIdentity(c)) };
}

/**
 * A sketch's frame in world coordinates: its stored `Placement` times the
 * placements of the containers that move what they hold, outermost first
 * (`containerChain`). A container loop leaves the containers out, with a
 * problem on `doc.problems`.
 */
export function sketchFrame(doc: FcDocument, sketch: FcObject): SketchFrameOf {
  const found = containerChain(doc, sketch);
  if (!found)
    doc.problems.push(
      `${sketch.name}: its containers hold each other in a loop; their placements are left out.`,
    );
  const chain = found?.chain ?? [];
  let global = placementOf(sketch) ?? identity;
  for (let i = chain.length - 1; i >= 0; i--) global = compose(chain[i] as FcPlacement, global);
  return { global, containers: chain.length, moved: found?.moved ?? false };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
/** A number for an expression: 15 significant digits, no exponent noise. */
const literal = (v: number) => `${Number(v.toPrecision(15))}`;
const planeKey = (v: number) => Number(v.toPrecision(12)).toString();

/** Planes made so far, per design: sketches on one plane share it. */
const madePlanes = new WeakMap<Design, Map<string, GeomRef>>();

/**
 * Forgets the planes `placeSketch` made for `d` that are no longer in its
 * timeline (an importer took back what it added for a feature), so a later
 * sketch makes its plane again instead of naming one that is gone.
 */
export function forgetRemovedPlanes(d: Design): void {
  const made = madePlanes.get(d);
  if (!made) return;
  const present = new Set<string>(d.doc.features.map((f) => f.id));
  for (const [key, plane] of made) if (!present.has(plane.id)) made.delete(key);
}

/** Why a sketch has no Extrudo plane. */
export const NO_PLANE =
  'its plane is tilted off every origin axis, and Extrudo has no plane for it';

/** Why a sketch whose frame is not a rigid one has no plane. */
export const BAD_FRAME = 'its placement is not a position and a rotation Extrudo can use';

/**
 * Whether a frame is a finite position and a rotation that keeps lengths.
 * A file's numbers can break one: container placements that add up past the
 * largest number, a rotation of all zeros.
 */
export function frameIsSound(global: FcPlacement): boolean {
  return (
    global.position.every(Number.isFinite) && Math.abs(Math.hypot(...global.rotation) - 1) <= 1e-6
  );
}

/**
 * Picks the Extrudo plane for a frame (world coordinates): an origin plane
 * when the normal is along one's (either way; mirrored when against it),
 * moved along it when the frame's origin is off it; else, when the normal
 * is square to an origin axis, a plane turned about that axis from the
 * origin plane through it, moved likewise. Planes are made through `d` and
 * shared by sketches of the same design. `undefined`: no plane fits
 * ({@link NO_PLANE}), or the frame is not sound ({@link frameIsSound}).
 */
export function placeSketch(
  d: Design,
  global: FcPlacement,
  name: string,
): SketchPlacement | undefined {
  if (!frameIsSound(global)) return undefined;
  const q = global.rotation;
  const O = global.position;
  const X = rotate(q, [1, 0, 0]);
  const Y = rotate(q, [0, 1, 0]);
  const N = rotate(q, [0, 0, 1]);
  const made = madePlanes.get(d) ?? new Map<string, GeomRef>();
  madePlanes.set(d, made);

  const placed = (plane: GeomRef, kind: PlaneKind, f: SketchFrame): SketchPlacement => {
    const [fo, fx, fy] = [f.origin as Vec3, f.x as Vec3, f.y as Vec3];
    // Rows of the 2D map: Extrudo x and y of FreeCAD's u and v axes.
    const [m00, m01, m10, m11] = [dot(X, fx), dot(Y, fx), dot(X, fy), dot(Y, fy)];
    const t: Vec2 = [dot(O, fx) - dot(fo, fx), dot(O, fy) - dot(fo, fy)];
    const map = (u: number, v: number): Vec2 => [
      t[0] + m00 * u + m01 * v,
      t[1] + m10 * u + m11 * v,
    ];
    const axes =
      Math.abs(m01) <= EPS && Math.abs(m10) <= EPS
        ? 'same'
        : Math.abs(m00) <= EPS && Math.abs(m11) <= EPS
          ? 'swap'
          : 'rotated';
    return { plane, kind, map, mirrored: m00 * m11 - m01 * m10 < 0, axes, frame: f, global };
  };
  /** `base` (normal `n`) moved along `n` to the frame's origin. */
  const moved = (base: GeomRef, n: Vec3): { plane: GeomRef; offset: number } => {
    const offset = dot(O, n);
    if (Math.abs(offset) <= 1e-9) return { plane: base, offset: 0 };
    const key = `${base.id}@${planeKey(offset)}`;
    let plane = made.get(key);
    if (!plane) {
      const p = d.offsetPlane(
        { plane: base, distance: `${literal(offset)} mm` },
        { name: `${name} plane` },
      );
      plane = { kind: 'plane', id: p.id };
      made.set(key, plane);
    }
    return { plane, offset };
  };

  for (const p of ORIGIN_PLANES) {
    const n = p.frame.normal as Vec3;
    if (Math.abs(Math.abs(dot(N, n)) - 1) > EPS) continue;
    const { plane, offset } = moved({ kind: 'plane', id: p.id }, n);
    // An offset plane's frame is `faceSketchFrame`'s, which on an origin plane's normal is that plane's axes.
    const frame: SketchFrame = { ...p.frame, origin: scale(n, offset) };
    return placed(plane, offset === 0 ? 'origin' : 'offset', frame);
  }
  for (const a of ORIGIN_AXES) {
    const axis = a.direction as Vec3;
    if (Math.abs(dot(N, axis)) > EPS) continue;
    const base = ORIGIN_PLANES.find((p) => Math.abs(dot(p.frame.normal as Vec3, axis)) < EPS);
    if (!base) continue;
    // Turned right-handed about the axis from the origin plane through it: that plane's normal goes to N.
    const zero = base.frame.normal as Vec3;
    const angle = (Math.atan2(dot(N, cross(axis, zero)), dot(N, zero)) * 180) / Math.PI;
    const key = `${a.id}:${planeKey(angle)}`;
    let turned = made.get(key);
    if (!turned) {
      const p = d.planeAtAngle(
        {
          axis: { kind: 'axis', id: a.id },
          plane: { kind: 'plane', id: base.id },
          angle: `${literal(angle)} deg`,
        },
        { name: `${name} plane` },
      );
      turned = { kind: 'plane', id: p.id };
      made.set(key, turned);
    }
    const { plane, offset } = moved(turned, N);
    return placed(
      plane,
      offset === 0 ? 'angle' : 'angle-offset',
      faceSketchFrame(scale(N, offset), N),
    );
  }
  return undefined;
}
