import {
  ellipseShape,
  fitSpline,
  originPlane,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type SketchFrame,
  type SketchInputs,
  sketchFeature,
  type Vec2,
} from '@extrudo/core';
import {
  detectProfiles,
  PROFILE_TOLERANCE,
  profileCentroid,
  profileIds,
  profileKey,
} from '@extrudo/sketch/profiles';
import { KernelError } from '../kernel';
import type { PlanarCurve, PlanarFace } from '../planar';
import type { KernelFeatureDefinition } from '../recompute/types';

/** A profile of a sketch as later features see it (`SketchOutputData.profiles`). */
export interface SketchProfileInfo {
  /** The region ID, as `detectProfiles` gives it and a profile reference names it. */
  id: string;
  /** mm². */
  area: number;
  holes: number;
  /** The sketch curve of each of the face's edges, in sub-shape order (`null` if unknown). */
  edges: (SketchEntityId | null)[];
}

/**
 * The `data` of a sketch's output. Its `shapes` hold one face per profile,
 * keyed by region ID and placed in the sketch plane: an extrude of the
 * profile `<sketch>/<region>` reads `ctx.output(sketch).shapes[region]`.
 */
export interface SketchOutputData {
  frame: SketchFrame;
  /** Largest first. */
  profiles: SketchProfileInfo[];
  /**
   * Every line of the sketch, construction lines too, from its start to its
   * end in sketch coordinates (mm): what a revolve's axis refers to
   * (`<sketch>/<line>`, ADR-0029). Placed in the world with `frame`.
   */
  lines?: Record<SketchEntityId, readonly [Vec2, Vec2]>;
}

/**
 * The sketch feature in the kernel (P2-02, ADR-0025). The sketch is solved
 * on the UI thread and stored solved (ADR-0010), so there is nothing to
 * solve here: the kernel turns its curves into exact edges, splits them
 * where they meet and makes a face of every region between them.
 */
export const kernelSketch: KernelFeatureDefinition<SketchInputs> = {
  ...sketchFeature,
  // A sketch on a face follows that face, so it depends on the bodies.
  bodyAccess: (inputs) => (inputs.plane.refs[0]?.kind === 'face' ? 'read' : 'none'),
  evaluate({ kernel, inputs }) {
    const plane = inputs.plane.refs[0];
    if (plane?.kind === 'face') {
      throw new KernelError("This version of Extrudo can't place a sketch on a face.");
    }
    const frame = plane ? originPlane(plane.id)?.frame : undefined;
    if (!frame) {
      throw new KernelError("Can't find this sketch's plane. Edit the sketch to pick another.");
    }
    const data = inputs.sketch.sketch;
    const { curves, ids } = planarCurves(data);
    using scope = kernel.scope();
    const { faces } = kernel.planarFaces(curves, frame, PROFILE_TOLERANCE);
    for (const face of faces) scope.track(face.shape);
    const regionIds = profileFaceIds(faces, ids, data).ids;

    const order = faces
      .map((_, i) => i)
      .sort(
        (a, b) =>
          faceArea(faces, b) - faceArea(faces, a) ||
          ((regionIds[a] as string) < (regionIds[b] as string) ? -1 : 1),
      );
    const shapes: Record<string, (typeof faces)[number]['shape']> = {};
    const profiles: SketchProfileInfo[] = [];
    for (const i of order) {
      const face = faces[i] as PlanarFace;
      // IDs are unique unless a hash collides; never drop a face over it.
      let id = regionIds[i] as string;
      while (id in shapes) id = `${id}~`;
      shapes[id] = scope.keep(face.shape);
      profiles.push({
        id,
        area: face.area,
        holes: face.holes,
        edges: face.edges.map((c) => ids[c] ?? null),
      });
    }
    const output: SketchOutputData = { frame, profiles, lines: sketchLines(data) };
    return { shapes, data: output };
  },
};

/** The sketch's lines (construction too) by entity ID, start to end. */
export function sketchLines(data: SketchData): Record<SketchEntityId, readonly [Vec2, Vec2]> {
  const out: Record<SketchEntityId, readonly [Vec2, Vec2]> = {};
  for (const [id, e] of Object.entries(data.entities) as [SketchEntityId, SketchEntity][]) {
    if (e.type !== 'line') continue;
    const a = data.entities[e.start];
    const b = data.entities[e.end];
    if (a?.type === 'point' && b?.type === 'point')
      out[id] = [
        [a.x, a.y],
        [b.x, b.y],
      ];
  }
  return out;
}

const faceArea = (faces: readonly PlanarFace[], i: number) => (faces[i] as PlanarFace).area;

/**
 * The sketch's curves for the kernel, in entity ID order (as
 * `detectProfiles` walks them), without points and construction geometry.
 * `ids[i]` is the entity of `curves[i]`.
 */
export function planarCurves(data: SketchData): { curves: PlanarCurve[]; ids: SketchEntityId[] } {
  const curves: PlanarCurve[] = [];
  const ids: SketchEntityId[] = [];
  const point = (ref: SketchEntityId): Vec2 | undefined => {
    const p = data.entities[ref];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  for (const id of Object.keys(data.entities).sort() as SketchEntityId[]) {
    const e = data.entities[id] as SketchEntity;
    if (e.type === 'point' || e.construction) continue;
    const curve = planarCurve(e, point);
    if (!curve) continue;
    curves.push(curve);
    ids.push(id);
  }
  return { curves, ids };
}

function planarCurve(
  e: Exclude<SketchEntity, { type: 'point' }>,
  point: (ref: SketchEntityId) => Vec2 | undefined,
): PlanarCurve | undefined {
  switch (e.type) {
    case 'line': {
      const a = point(e.start);
      const b = point(e.end);
      return a && b ? { kind: 'line', a, b } : undefined;
    }
    case 'circle': {
      const center = point(e.center);
      return center && { kind: 'arc', center, radius: e.radius, from: 0, sweep: 2 * Math.PI };
    }
    case 'arc': {
      const center = point(e.center);
      const s = point(e.start);
      const t = point(e.end);
      if (!center || !s || !t) return undefined;
      // As detectProfiles and the viewport read it: counter-clockwise from the start,
      // with the start's radius; ends that coincide make a full circle.
      const from = Math.atan2(s[1] - center[1], s[0] - center[0]);
      let sweep = (Math.atan2(t[1] - center[1], t[0] - center[0]) - from) % (2 * Math.PI);
      if (sweep < 0) sweep += 2 * Math.PI;
      if (sweep <= 1e-12) sweep = 2 * Math.PI;
      const radius = Math.hypot(s[0] - center[0], s[1] - center[1]);
      return { kind: 'arc', center, radius, from, sweep };
    }
    case 'ellipse': {
      const center = point(e.center);
      const major = point(e.major);
      const minor = point(e.minor);
      if (!center || !major || !minor) return undefined;
      const { a, b, rotation } = ellipseShape(center, major, minor);
      return { kind: 'ellipse', center, a, b, rotation };
    }
    case 'spline': {
      const fit = e.points.map(point);
      if (!fit.every((p) => p !== undefined)) return undefined;
      const { degree, poles, knots } = fitSpline(fit);
      return { kind: 'spline', degree, poles, knots };
    }
  }
}

/**
 * Region IDs for the kernel's faces of a sketch. Each face is keyed by the
 * curves around its outer loop and their directions, exactly as
 * `detectProfiles` keys its regions (ADR-0020), so the IDs agree with the
 * profiles the sketch shows and a user selects.
 *
 * The two can still differ where exact curves and the arrangement's
 * polylines part ways (an ellipse or spline grazing another curve). As a
 * safety net, a face whose ID isn't a detected region of the same area and
 * centroid takes the ID of the unclaimed region that is; `reassigned`
 * counts those (the tests expect none).
 */
export function profileFaceIds(
  faces: readonly PlanarFace[],
  curveIds: readonly SketchEntityId[],
  data: SketchData,
): { ids: string[]; reassigned: number } {
  const own = profileIds(
    faces.map((face) => ({
      key: profileKey(
        face.outer.map((e) => ({
          curve: curveIds[e.curve] as SketchEntityId,
          reversed: e.reversed,
        })),
      ),
      centroid: face.centroid,
    })),
  );
  const detected = detectProfiles(data).map((p) => ({
    id: p.id,
    area: p.area,
    centroid: profileCentroid(p),
  }));
  const byId = new Map(detected.map((p) => [p.id, p]));
  const claimed = new Set<string>();
  const ids: (string | undefined)[] = faces.map((face, i) => {
    const id = own[i] as string;
    const region = byId.get(id);
    if (!region || !sameRegion(face, region)) return undefined;
    claimed.add(id);
    return id;
  });

  let reassigned = 0;
  faces.forEach((face, i) => {
    if (ids[i] !== undefined) return;
    let best: (typeof detected)[number] | undefined;
    for (const region of detected) {
      if (claimed.has(region.id) || !sameRegion(face, region)) continue;
      if (
        !best ||
        distance(face.centroid, region.centroid) < distance(face.centroid, best.centroid)
      ) {
        best = region;
      }
    }
    if (best) {
      claimed.add(best.id);
      reassigned++;
    }
    ids[i] = best?.id ?? (own[i] as string);
  });
  return { ids: ids as string[], reassigned };
}

const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Whether a face and a detected region are the same piece of the plane. The
 * arrangement's ellipses and splines are polylines (a spline's area is off
 * by about 1 %), so allow a few percent.
 */
function sameRegion(face: PlanarFace, region: { area: number; centroid: Vec2 }): boolean {
  const scale = Math.max(face.area, region.area);
  return (
    Math.abs(face.area - region.area) <= 0.05 * scale + 1e-6 &&
    distance(face.centroid, region.centroid) <= 0.05 * Math.sqrt(scale) + 1e-3
  );
}
