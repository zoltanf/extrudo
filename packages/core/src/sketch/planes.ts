/**
 * Sketch planes and their 2D frames (P1-01, ADR-0010).
 *
 * A sketch lives in a plane with its own frame: an origin, the sketch's X and
 * Y directions and the normal (X × Y), all in world coordinates (Z up, mm).
 * The origin planes' frames match the ViewCube: looking at the plane from its
 * normal (Top, Front or Right view), sketch X points right and sketch Y up.
 * Construction planes (P3-05) and flat faces (P2) get their frames from the
 * kernel on each recompute; they aren't known here.
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
