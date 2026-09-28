/**
 * Sketch planes and their 2D frames (P1-01, ADR-0010).
 *
 * A sketch lives in a plane with its own frame: an origin, the sketch's X and
 * Y directions and the normal (X × Y), all in world coordinates (Z up, mm).
 * The origin planes' frames match the ViewCube: looking at the plane from its
 * normal (Top, Front or Right view), sketch X points right and sketch Y up.
 * Construction planes (P3-05) and flat faces (P2-09) get their frames from
 * the kernel on each recompute (`SketchReport.frame`); for a face the frame
 * follows one rule, `faceSketchFrame`, from the face's plane.
 */
import type { GeomRef } from '../schema';

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export interface SketchFrame {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  normal: Vec3;
}

export type OriginPlaneId = 'origin:xy' | 'origin:xz' | 'origin:yz';

export interface OriginPlane {
  id: OriginPlaneId;
  label: string;
  frame: SketchFrame;
}

export const ORIGIN_PLANES: readonly OriginPlane[] = [
  {
    id: 'origin:xy',
    label: 'XY plane',
    frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  },
  {
    id: 'origin:xz',
    label: 'XZ plane',
    frame: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  },
  {
    id: 'origin:yz',
    label: 'YZ plane',
    frame: { origin: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
  },
];

export function originPlane(id: string): OriginPlane | undefined {
  return ORIGIN_PLANES.find((p) => p.id === id);
}

/** A plane reference for an origin plane. */
export function originPlaneRef(id: OriginPlaneId): GeomRef {
  return { kind: 'plane', id };
}

/**
 * The frame of a sketch plane, when it can be known without the kernel:
 * today, the origin planes. `undefined` for faces and construction planes.
 */
export function planeFrame(ref: GeomRef): SketchFrame | undefined {
  return ref.kind === 'plane' ? originPlane(ref.id)?.frame : undefined;
}

/**
 * How steep a face may be, from horizontal, and still count as a floor or a
 * roof in `faceSketchFrame`: 40°, away from the common 0°, 45° and 90°, so
 * a small change to the model never flips the frame.
 */
export const FLAT_FACE_TILT = (40 * Math.PI) / 180;

/**
 * The frame of a sketch on a flat face (P2-09, ADR-0031), from a point of
 * its plane and its outward normal. It depends on the plane alone, not on
 * the face's outline, so it holds still while the face changes shape:
 *
 * - **Normal:** the face's outward normal.
 * - **Origin:** the world origin projected onto the plane, so a sketch on
 *   a box's top face has the same x and y as one on the XY plane, and
 *   stays put when the face grows or a hole is cut into it.
 * - **Axes:** a face within `FLAT_FACE_TILT` of horizontal (a floor or a
 *   roof) takes sketch X along world X, as the Top and Bottom views show
 *   it; a steeper face (a wall) takes sketch Y straight up the face, world
 *   Z, as the Front, Back, Left and Right views show it. Sketch Y is
 *   normal × X (or X is Y × normal), so the frame is right-handed. On the
 *   origin planes' normals this gives exactly their frames.
 */
export function faceSketchFrame(point: Vec3, normal: Vec3): SketchFrame {
  const n = unit(normal);
  const offset = point[0] * n[0] + point[1] * n[1] + point[2] * n[2];
  const origin = clean([offset * n[0], offset * n[1], offset * n[2]]);
  let x: Vec3;
  let y: Vec3;
  if (Math.abs(n[2]) >= Math.cos(FLAT_FACE_TILT)) {
    x = unit([1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]]);
    y = cross(n, x);
  } else {
    y = unit([-n[2] * n[0], -n[2] * n[1], 1 - n[2] * n[2]]);
    x = cross(y, n);
  }
  return { origin, x: clean(x), y: clean(y), normal: clean(n) };
}

/**
 * The frame a face reference had when it was picked, from its fingerprint
 * (a plane's centroid and outward normal): what a sketch on that face shows
 * until the kernel has computed the face's current frame, or when it can't
 * find the face any more. `undefined` without a planar fingerprint.
 */
export function fingerprintFrame(ref: GeomRef): SketchFrame | undefined {
  const f = ref.kind === 'face' ? ref.fingerprint : undefined;
  if (f?.type !== 'plane' || !f.dir) return undefined;
  return faceSketchFrame(f.at, f.dir);
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Rounding noise off: −0 and components within 1e-12 of 0 or ±1. */
function clean(v: Vec3): Vec3 {
  const c = (x: number) => {
    if (Math.abs(x) < 1e-12) return 0;
    if (Math.abs(Math.abs(x) - 1) < 1e-12) return Math.sign(x);
    return x;
  };
  return [c(v[0]), c(v[1]), c(v[2])];
}

/** A sketch point in world coordinates. */
export function sketchToWorld(frame: SketchFrame, [u, v]: Vec2): Vec3 {
  const { origin: o, x, y } = frame;
  return [o[0] + u * x[0] + v * y[0], o[1] + u * x[1] + v * y[1], o[2] + u * x[2] + v * y[2]];
}

/** A world point projected into the sketch plane. */
export function worldToSketch(frame: SketchFrame, p: Vec3): Vec2 {
  const d = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]] as const;
  const dot = (a: Vec3) => d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  return [dot(frame.x), dot(frame.y)];
}
