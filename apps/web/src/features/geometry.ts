/**
 * Where manipulators go (ADR-0027): the centre and normal of a picked face
 * from its mesh, and of a sketch profile from its sketch. UI-thread
 * geometry for placing handles; the kernel computes the feature itself.
 */
import {
  type BodyId,
  type ExtrudoDocument,
  type GeomRef,
  parseProfileRefId,
  planeFrame,
  readSketch,
  sketchToWorld,
  type Vec3,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { profileCentroid } from '@extrudo/sketch/profiles';
import { sketchProfiles } from '../sketch/profiles';

export interface Frame {
  /** The area centroid, world mm. */
  origin: Vec3;
  /** Unit length: a face's outward normal (area-weighted), a sketch plane's normal. */
  normal: Vec3;
}

/**
 * A face's area centroid and mean normal from its triangles, found by its
 * persistent ID in the meshes. Undefined for another kind or a face the
 * meshes don't have.
 */
export function faceFrame(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  ref: GeomRef,
): Frame | undefined {
  if (ref.kind !== 'face') return undefined;
  for (const mesh of Object.values(bodies)) {
    const face = mesh.faceIds?.indexOf(ref.id) ?? -1;
    if (face >= 0) return meshFaceFrame(mesh, face);
  }
  return undefined;
}

/** The frame of face `face` (index in `faceRanges`) of a mesh. */
export function meshFaceFrame(mesh: BodyMesh, face: number): Frame | undefined {
  const first = mesh.faceRanges[2 * face] ?? 0;
  const count = mesh.faceRanges[2 * face + 1] ?? 0;
  const { positions: p, indices } = mesh;
  let area = 0;
  const c = [0, 0, 0];
  const n = [0, 0, 0];
  for (let t = first; t < first + count; t++) {
    const [a, b, d] = [indices[3 * t] ?? 0, indices[3 * t + 1] ?? 0, indices[3 * t + 2] ?? 0];
    const v = (i: number, k: number) => p[3 * i + k] ?? 0;
    const e1 = [v(b, 0) - v(a, 0), v(b, 1) - v(a, 1), v(b, 2) - v(a, 2)];
    const e2 = [v(d, 0) - v(a, 0), v(d, 1) - v(a, 1), v(d, 2) - v(a, 2)];
    const cross = [
      (e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0),
      (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0),
      (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0),
    ];
    const twice = Math.hypot(cross[0] ?? 0, cross[1] ?? 0, cross[2] ?? 0);
    area += twice / 2;
    for (let k = 0; k < 3; k++) {
      c[k] = (c[k] ?? 0) + ((twice / 2) * (v(a, k) + v(b, k) + v(d, k))) / 3;
      n[k] = (n[k] ?? 0) + (cross[k] ?? 0);
    }
  }
  const length = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
  if (area <= 0 || length <= 0) return undefined;
  return {
    origin: [(c[0] ?? 0) / area, (c[1] ?? 0) / area, (c[2] ?? 0) / area],
    normal: [(n[0] ?? 0) / length, (n[1] ?? 0) / length, (n[2] ?? 0) / length],
  };
}

/**
 * A sketch profile's centroid on its plane and the plane's normal, from
 * the document (the app's profile cache). Undefined for another kind, or
 * a profile, sketch or plane that isn't there.
 */
export function profileFrame(doc: ExtrudoDocument, ref: GeomRef): Frame | undefined {
  if (ref.kind !== 'profile') return undefined;
  const parsed = parseProfileRefId(ref.id);
  const feature = parsed && doc.features.find((f) => f.id === parsed.feature);
  const sketch = feature && readSketch(feature);
  const frame = sketch && planeFrame(sketch.plane);
  const profile = sketch && sketchProfiles(sketch.data).find((p) => p.id === parsed?.profile);
  if (!frame || !profile) return undefined;
  return { origin: sketchToWorld(frame, profileCentroid(profile)), normal: frame.normal };
}

/** The mean of the frames' origins, with the first one's normal (several picks). */
export function meanFrame(frames: readonly (Frame | undefined)[]): Frame | undefined {
  const found = frames.filter((f): f is Frame => f !== undefined);
  const first = found[0];
  if (!first) return undefined;
  const sum = [0, 1, 2].map((k) => found.reduce((s, f) => s + (f.origin[k] ?? 0), 0));
  return {
    origin: [
      (sum[0] ?? 0) / found.length,
      (sum[1] ?? 0) / found.length,
      (sum[2] ?? 0) / found.length,
    ],
    normal: first.normal,
  };
}
