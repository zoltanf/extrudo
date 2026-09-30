/**
 * Section analysis maths (P3-09, ADR-0045): the clipping plane of a
 * section, where its arrow stands and what a plane lets through. Pure over
 * plain 3-vectors (no three.js, no React), so it runs in Vitest and the
 * picking code can share it.
 *
 * A section keeps the side of its plane that the plane's normal points away
 * from and clips the other one: on the XY plane at 20 mm the model is cut
 * away above z = 20, looking into it from the top. **Flip** turns that
 * around. The offset always moves the plane along the picked plane's own
 * normal, flipped or not, so flipping keeps the cut where it is.
 */
import {
  type ConstructionReports,
  fingerprintFrame,
  type GeomRef,
  planeFrame,
  type Vec3,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { type Frame, faceFrame } from '../features/geometry';

/**
 * The section as the view keeps it (viewport state, never in the document):
 * the plane it lies on, the offset along that plane's normal, which side
 * goes, and whether the view is clipped at all. Turning the section off
 * keeps the rest, so it comes back as it was.
 */
export interface SectionState {
  /**
   * An origin plane (`origin:xy`), a construction plane (its feature's ID) or a flat
   * face (a persistent reference: it follows the model through recomputes).
   */
  plane: GeomRef;
  /** An expression in the document's length unit ("10 mm", "wall / 2"). */
  offset: string;
  /** The side that is removed is the one the plane's normal points away from. */
  flip: boolean;
  /** The view is clipped. */
  on: boolean;
}

/**
 * A section plane in the world: the point `origin` and the unit `normal`,
 * which points to the side that is **removed**.
 */
export interface SectionClip {
  origin: Vec3;
  normal: Vec3;
}

/** A point this close (mm) to the plane still counts as kept: faces lying in it stay. */
export const CLIP_EPS = 1e-6;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** How far a point lies on the removed side of the plane, mm (negative on the kept side). */
export function clipDistance(clip: SectionClip, x: number, y: number, z: number): number {
  const { origin: o, normal: n } = clip;
  return (x - o[0]) * n[0] + (y - o[1]) * n[1] + (z - o[2]) * n[2];
}

/** Whether a point is clipped away. */
export function isClipped(clip: SectionClip, x: number, y: number, z: number): boolean {
  return clipDistance(clip, x, y, z) > CLIP_EPS;
}

/** What the section needs to find its plane. */
export interface SectionScene {
  construction?: ConstructionReports | undefined;
  /** The meshes the view draws: a face reference finds its face here. */
  bodies: Readonly<Record<string, BodyMesh>>;
}

/**
 * Where the section's picked plane is (before the offset): an origin
 * plane's or a construction plane's frame, a flat face's centre and outward
 * normal from the current mesh (the reference's fingerprint until the meshes
 * have the face). Undefined for a plane that isn't there any more.
 */
export function sectionFrame(plane: GeomRef, scene: SectionScene): Frame | undefined {
  if (plane.kind === 'face') {
    const face = faceFrame(scene.bodies, plane);
    if (face) return face;
    const from = fingerprintFrame(plane);
    const f = plane.fingerprint;
    // The fingerprint's own centre, not the sketch frame's projected origin.
    return from && f?.type === 'plane' && f.dir ? { origin: f.at, normal: from.normal } : undefined;
  }
  const frame = planeFrame(plane, scene.construction);
  return frame && { origin: frame.origin, normal: frame.normal };
}

/** The clipping plane for a frame, an offset (mm along the frame's normal) and the flip. */
export function sectionClip(frame: Frame, offset: number, flip: boolean): SectionClip {
  const n = frame.normal;
  const o = frame.origin;
  return {
    origin: [o[0] + n[0] * offset, o[1] + n[1] * offset, o[2] + n[2] * offset],
    // `0 - x` rather than `-x`: no negative zeros in the normal.
    normal: flip ? [0 - n[0], 0 - n[1], 0 - n[2]] : [n[0], n[1], n[2]],
  };
}

/**
 * The point on the section's plane (at offset 0) that its arrow stands on:
 * the middle of what is shown, projected onto the plane, so the handle is
 * in view whatever the plane.
 */
export function arrowBase(frame: Frame, center: Vec3): Vec3 {
  const n = frame.normal;
  const d = dot(
    [center[0] - frame.origin[0], center[1] - frame.origin[1], center[2] - frame.origin[2]],
    n,
  );
  return [center[0] - n[0] * d, center[1] - n[1] * d, center[2] - n[2] * d];
}

/**
 * The offset that cuts through the middle of a box, mm along the frame's
 * normal: a new section starts there so that it shows something at once.
 * A face's plane sits on the model's surface, an origin plane may lie
 * outside it.
 */
export function middleOffset(frame: Frame, box: { min: Vec3; max: Vec3 }): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? box.max[0] : box.min[0],
      i & 2 ? box.max[1] : box.min[1],
      i & 4 ? box.max[2] : box.min[2],
    ];
    const d = dot(
      [corner[0] - frame.origin[0], corner[1] - frame.origin[1], corner[2] - frame.origin[2]],
      frame.normal,
    );
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return (lo + hi) / 2;
}

/**
 * The section for tests (`data-section`): the plane's reference, the offset
 * expression, the flip and the state, "origin:xy offset=20 mm on" or
 * "origin:xz offset=0 flipped off".
 */
export function sectionSummary(state: SectionState | undefined): string | undefined {
  if (!state) return undefined;
  const label = state.plane.kind === 'face' ? `face:${state.plane.id}` : state.plane.id;
  return `${label} offset=${state.offset}${state.flip ? ' flipped' : ''} ${state.on ? 'on' : 'off'}`;
}

/**
 * The clip for tests (`data-section-clip`): "<origin>:<normal>" of the plane in the world,
 * numbers to 0.001 mm, "0,0,20:0,0,1".
 */
export function clipSummary(clip: SectionClip | undefined): string | undefined {
  if (!clip) return undefined;
  const f = (v: Vec3) => v.map((c) => `${Math.round(c * 1000) / 1000 + 0}`).join(',');
  return `${f(clip.origin)}:${f(clip.normal)}`;
}
