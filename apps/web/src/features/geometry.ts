/**
 * Where manipulators go (ADR-0027): the centre and normal of a picked face
 * from its mesh, and of a sketch profile from its sketch. UI-thread
 * geometry for placing handles; the kernel computes the feature itself.
 */
import {
  type BodyId,
  type ConstructionReports,
  constructionAxisLine,
  type ExtrudoDocument,
  type FeatureId,
  type GeomRef,
  originAxis,
  parseProfileRefId,
  parseSketchEntityRefId,
  readSketch,
  type SketchReport,
  sketchToWorld,
  type Vec3,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { profileCentroid } from '@extrudo/sketch/profiles';
import { sketchFrame } from '../sketch/frame';
import { sketchProfiles } from '../sketch/profiles';

export interface Frame {
  /** The area centroid, world mm. */
  origin: Vec3;
  /** Unit length: a face's outward normal (area-weighted), a sketch plane's normal. */
  normal: Vec3;
  /**
   * How much the face's normals agree, 0 to 1 (a face's triangles only): 1 for a flat
   * face, less the more it curves, near 0 for a whole cylinder wall.
   */
  flatness?: number;
}

/**
 * Where an arrow that moves a face sits (P3-08): a flat face's centroid
 * and normal, and for a curved face (a cylinder's wall, whose mean normal
 * is meaningless) a point of the surface near the centroid with the normal
 * there. Undefined for another kind or a face the meshes don't have.
 */
export function surfaceFrame(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  ref: GeomRef,
): Frame | undefined {
  if (ref.kind !== 'face') return undefined;
  for (const mesh of Object.values(bodies)) {
    const face = mesh.faceIds?.indexOf(ref.id) ?? -1;
    if (face >= 0) return meshSurfaceFrame(mesh, face);
  }
  return undefined;
}

/** `surfaceFrame` of face `face` (index in `faceRanges`) of a mesh. */
export function meshSurfaceFrame(mesh: BodyMesh, face: number): Frame | undefined {
  return meshSurfaceFrameAt(mesh, face);
}

/**
 * `surfaceFrame` of a picked face, taken at the point of its surface nearest
 * `at` instead of at the face's own middle: on a round face the middle is on
 * the axis, which is nowhere near the letters an emboss puts there (P4-04).
 */
export function surfaceFrameNear(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  ref: GeomRef,
  at: Vec3,
): Frame | undefined {
  if (ref.kind !== 'face') return undefined;
  for (const mesh of Object.values(bodies)) {
    const face = mesh.faceIds?.indexOf(ref.id) ?? -1;
    if (face >= 0) return meshSurfaceFrameAt(mesh, face, at);
  }
  return undefined;
}

/** `meshSurfaceFrame` with the query point the node is chosen by. */
export function meshSurfaceFrameAt(mesh: BodyMesh, face: number, at?: Vec3): Frame | undefined {
  const mean = meshFaceFrame(mesh, face);
  if (mean && (mean.flatness ?? 1) >= 0.98) return mean;
  const first = mesh.faceRanges[2 * face] ?? 0;
  const count = mesh.faceRanges[2 * face + 1] ?? 0;
  const centre = at ?? mean?.origin;
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let t = first; t < first + count; t++) {
    for (let k = 0; k < 3; k++) {
      const node = mesh.indices[3 * t + k] ?? 0;
      const p = mesh.positions;
      const d = centre
        ? Math.hypot(
            (p[3 * node] ?? 0) - centre[0],
            (p[3 * node + 1] ?? 0) - centre[1],
            (p[3 * node + 2] ?? 0) - centre[2],
          )
        : 0;
      if (d < bestDistance) {
        bestDistance = d;
        best = node;
      }
    }
  }
  if (best === undefined) return mean;
  const node = (a: Float32Array): Vec3 => [
    a[3 * best] ?? 0,
    a[3 * best + 1] ?? 0,
    a[3 * best + 2] ?? 0,
  ];
  const n = node(mesh.normals);
  const length = Math.hypot(n[0], n[1], n[2]);
  if (length <= 0) return mean;
  return { origin: node(mesh.positions), normal: [n[0] / length, n[1] / length, n[2] / length] };
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
    flatness: Math.min(1, length / (2 * area)),
  };
}

/**
 * A sketch profile's centroid on its plane and the plane's normal, from
 * the document (the app's profile cache). Undefined for another kind, or
 * a profile, sketch or plane that isn't there.
 */
export function profileFrame(
  doc: ExtrudoDocument,
  ref: GeomRef,
  sketches?: Readonly<Record<FeatureId, SketchReport>>,
  construction?: ConstructionReports,
): Frame | undefined {
  if (ref.kind !== 'profile') return undefined;
  const parsed = parseProfileRefId(ref.id);
  const feature = parsed && doc.features.find((f) => f.id === parsed.feature);
  const sketch = feature && readSketch(feature);
  const frame = sketch && feature && sketchFrame(feature.id, sketch.plane, sketches, construction);
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

/** A line in space: a point on it and its unit direction. */
export interface AxisLine {
  origin: Vec3;
  direction: Vec3;
}

/**
 * Where a revolve axis lies, for placing its arcs (ADR-0029): an origin
 * axis, a sketch line from its start to its end (from the document), or a
 * straight edge of a mesh from its first to its last point. Undefined for
 * another kind, or what the document or the meshes don't have.
 */
export function axisLine(
  ref: GeomRef,
  ctx: {
    doc: ExtrudoDocument;
    bodies: Readonly<Record<BodyId, BodyMesh>>;
    sketches?: Readonly<Record<FeatureId, SketchReport>>;
    construction?: ConstructionReports;
  },
): AxisLine | undefined {
  if (ref.kind === 'axis') {
    const axis = originAxis(ref.id);
    return axis
      ? { origin: axis.origin, direction: axis.direction }
      : constructionAxisLine(ref, ctx.construction);
  }
  if (ref.kind === 'sketchEntity') {
    const line = sketchLine(ctx.doc, ref, ctx.sketches, ctx.construction);
    return line && lineThrough(line[0], line[1]);
  }
  if (ref.kind === 'edge') {
    for (const mesh of Object.values(ctx.bodies)) {
      const edge = mesh.edgeIds?.indexOf(ref.id) ?? -1;
      if (edge < 0) continue;
      const first = mesh.edgeRanges[2 * edge] ?? 0;
      const count = mesh.edgeRanges[2 * edge + 1] ?? 0;
      if (count < 2) return undefined;
      const p = mesh.edgePoints;
      const at = (i: number): Vec3 => [p[3 * i] ?? 0, p[3 * i + 1] ?? 0, p[3 * i + 2] ?? 0];
      return lineThrough(at(first), at(first + count - 1));
    }
  }
  return undefined;
}

/**
 * The world end points of a sketch line picked in the model
 * (`<sketch>/<entity>`), or undefined when it isn't a line of a sketch on
 * a known plane (a face's frame comes from the kernel's sketch reports).
 */
export function sketchLine(
  doc: ExtrudoDocument,
  ref: GeomRef,
  sketches?: Readonly<Record<FeatureId, SketchReport>>,
  construction?: ConstructionReports,
): [Vec3, Vec3] | undefined {
  const parsed = parseSketchEntityRefId(ref.id);
  const feature = parsed && doc.features.find((f) => f.id === parsed.feature);
  const sketch = feature && readSketch(feature);
  const frame = sketch && feature && sketchFrame(feature.id, sketch.plane, sketches, construction);
  const line = parsed && sketch?.data.entities[parsed.entity];
  if (!frame || line?.type !== 'line') return undefined;
  const a = sketch.data.entities[line.start];
  const b = sketch.data.entities[line.end];
  if (a?.type !== 'point' || b?.type !== 'point') return undefined;
  return [sketchToWorld(frame, [a.x, a.y]), sketchToWorld(frame, [b.x, b.y])];
}

function lineThrough(a: Vec3, b: Vec3): AxisLine | undefined {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  if (length <= 1e-9) return undefined;
  return { origin: a, direction: [d[0] / length, d[1] / length, d[2] / length] };
}
