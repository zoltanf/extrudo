import {
  curvePolyline,
  ellipseShape,
  faceSketchFrame,
  fitSpline,
  type GeomRef,
  originPlane,
  type ProjectedCurve,
  type ProjectionId,
  type ProjectionReport,
  placeText,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type SketchFrame,
  type SketchInputs,
  type SketchReport,
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
import { LostReferenceError } from '../naming/resolve';
import type { PlanarCurve, PlanarFace } from '../planar';
import type { EvalContext, KernelFeatureDefinition } from '../recompute/types';
import { projectEdge, projectSegment } from './projection';
import { planeOf } from './references';

/** A profile of a sketch as later features see it (`SketchOutputData.profiles`). */
export interface SketchProfileInfo {
  /** The region ID, as `detectProfiles` gives it and a profile reference names it. */
  id: string;
  /** mm². */
  area: number;
  holes: number;
  /** The sketch curve of each of the face's edges, in sub-shape order (`null` if unknown). */
  edges: (SketchEntityId | null)[];
  /**
   * The text entity this region is ink of (P4-03, ADR-0058 §5), copied from
   * the `detectProfiles` profile with the same region ID. A whole-text
   * reference (a `sketchEntity` ref to the text) takes every face whose
   * `text` is it.
   */
  text?: SketchEntityId;
}

/**
 * The `data` of a sketch's output. Its `shapes` hold one face per profile,
 * keyed by region ID and placed in the sketch plane: an extrude of the
 * profile `<sketch>/<region>` reads `ctx.output(sketch).shapes[region]`.
 */
export interface SketchOutputData {
  /**
   * The sketch-to-world frame: sketch (x, y) is `origin + x·x + y·y` in
   * world mm. An origin plane's fixed frame, or a face's (`faceSketchFrame`,
   * P2-09), which follows the face through recompute.
   */
  frame: SketchFrame;
  /** Largest first. */
  profiles: SketchProfileInfo[];
  /**
   * Every line of the sketch, construction lines too, from its start to its
   * end in sketch coordinates (mm): what a revolve's axis refers to
   * (`<sketch>/<line>`, ADR-0029). Placed in the world with `frame`.
   */
  lines?: Record<SketchEntityId, readonly [Vec2, Vec2]>;
  /**
   * Every curve of the sketch (lines, arcs, circles, ellipses, splines),
   * construction ones too, in sketch coordinates: what a path pattern
   * follows (`<sketch>/<curve>`, P3-07). Placed in the world with `frame`.
   */
  curves?: Record<SketchEntityId, SketchPathCurve>;
  /**
   * Every curve of the sketch, construction ones too, as the kernel stages
   * it (exact lines, arcs, circles, ellipses and splines), in sketch
   * coordinates: what a sweep's path is made of (P4-01). Placed with `frame`.
   */
  exact?: Record<SketchEntityId, PlanarCurve>;
  /**
   * Every point of the sketch (loose points, curve ends and centres, and
   * construction points), in sketch coordinates: what a hole's sketch
   * points refer to (`<sketch>/<point>`, P3-04). Placed in the world with
   * `frame`.
   */
  points?: Record<SketchEntityId, Vec2>;
  /**
   * Every text entity of the sketch (construction ones too), P4-03: what a
   * whole-text reference (`<sketch>/<text>`, ADR-0058 §5) names. A ref to
   * an ID not in here is a lost reference; one in here without ink faces
   * means the text draws nothing (no font, empty, construction).
   */
  texts?: SketchEntityId[];
}

/** A sketch curve as a path pattern walks it: exact arcs, polylines for the rest. */
export type SketchPathCurve =
  | { type: 'polyline'; points: Vec2[] }
  /** Counter-clockwise from angle `from` (radians) by `sweep`; a circle is a whole turn. */
  | { type: 'arc'; center: Vec2; radius: number; from: number; sweep: number };

/**
 * The sketch feature in the kernel (P2-02, ADR-0025). The sketch is solved
 * on the UI thread and stored solved (ADR-0010), so there is nothing to
 * solve here: the kernel turns its curves into exact edges, splits them
 * where they meet and makes a face of every region between them.
 */
export const kernelSketch: KernelFeatureDefinition<SketchInputs> = {
  ...sketchFeature,
  // A sketch on a face follows that face, and projections follow their sources:
  // both depend on the bodies.
  bodyAccess: (inputs) =>
    inputs.plane.refs[0]?.kind === 'face' ||
    Object.keys(inputs.sketch.sketch.projections ?? {}).length > 0
      ? 'read'
      : 'none',
  evaluate(ctx) {
    const { kernel, inputs } = ctx;
    const frame = sketchFrame(ctx, inputs.plane.refs[0]);
    const data = inputs.sketch.sketch;
    const projections = projectAll(ctx, data, frame);
    const { curves, ids } = planarCurves(data);
    using scope = kernel.scope();
    const { faces } = kernel.planarFaces(curves, frame, PROFILE_TOLERANCE);
    for (const face of faces) scope.track(face.shape);
    const { ids: regionIds, textOf } = profileFaceIds(faces, ids, data);

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
      const text = textOf.get(id);
      profiles.push({
        id,
        area: face.area,
        holes: face.holes,
        edges: face.edges.map((c) => ids[c] ?? null),
        ...(text && { text }),
      });
    }
    const warnings = textWarnings(data);
    const texts = textsOf(data);
    const output: SketchOutputData = {
      frame,
      profiles,
      lines: sketchLines(data),
      curves: sketchCurves(data),
      exact: exactCurves(data),
      points: sketchPoints(data),
      ...(texts.length > 0 && { texts }),
    };
    const report: SketchReport = {
      frame,
      ...(Object.keys(projections).length > 0 && { projections }),
    };
    return { shapes, data: output, report, ...(warnings.length > 0 && { warnings }) };
  },
};

/**
 * The sketch's frame: an origin plane's, a construction plane's (P3-05), or
 * a flat face's (P2-09), resolved through topological naming so the sketch
 * follows the face.
 */
function sketchFrame(ctx: EvalContext<SketchInputs>, plane: GeomRef | undefined): SketchFrame {
  if (plane?.kind === 'face') {
    const hit = ctx.resolve(plane, { label: 'the face to sketch on' });
    const face = ctx.describe(hit.shape).faces[hit.index];
    if (face?.type !== 'plane' || !face.direction) {
      throw new KernelError(
        "The face this sketch is on isn't flat any more. Delete the sketch, or undo the change that curved the face.",
      );
    }
    return faceSketchFrame(face.centroid, face.direction);
  }
  const origin = plane ? originPlane(plane.id)?.frame : undefined;
  if (origin) return origin;
  // A construction plane (P3-05): the feature's own frame, followed through recompute.
  const message = "Can't find this sketch's plane. Redefine its plane to pick another.";
  if (plane?.kind === 'plane' && !plane.id.startsWith('origin:')) {
    return planeOf(ctx as unknown as EvalContext, plane, "this sketch's plane", message).frame;
  }
  throw plane ? new LostReferenceError(message, plane) : new KernelError(message);
}

/**
 * Where each projection's source is now, in the sketch plane (P2-09): the
 * curves by key, as `SketchProjection.curves` keys them. A source that
 * can't be found is reported lost, with a warning; the sketch still
 * computes with the curves where they were.
 */
function projectAll(
  ctx: EvalContext<SketchInputs>,
  data: SketchData,
  frame: SketchFrame,
): Record<ProjectionId, ProjectionReport> {
  const out: Record<ProjectionId, ProjectionReport> = {};
  for (const [pid, projection] of Object.entries(data.projections ?? {})) {
    const { ref } = projection;
    const what = ref.kind === 'face' ? 'face' : 'edge';
    try {
      out[pid as ProjectionId] = { curves: projectSource(ctx, ref, frame) };
    } catch (error) {
      if (!(error instanceof KernelError)) throw error;
      ctx.warn(
        `Lost a projected ${what} after an earlier change; its curves stay where they were. Delete them, or project the ${what} again.`,
      );
      out[pid as ProjectionId] = { lost: true };
    }
  }
  return out;
}

/** The curves of one projected edge or face, by key. */
function projectSource(
  ctx: EvalContext<SketchInputs>,
  ref: GeomRef,
  frame: SketchFrame,
): Record<string, ProjectedCurve> {
  const { kernel } = ctx;
  const curves: Record<string, ProjectedCurve> = {};
  if (ref.kind === 'edge') {
    const hit = ctx.resolve(ref, { label: 'the projected edge' });
    const curve = projectEdge(kernel.edgeGeometry(hit.shape, hit.index), frame);
    if (curve) curves.edge = curve;
    return curves;
  }
  const hit = ctx.resolve(ref, { label: 'the projected face' });
  const description = ctx.describe(hit.shape);
  const names = ctx.names(hit.body).edges;
  using scope = kernel.scope();
  const face = scope.track(kernel.subShape(hit.shape, 'face', hit.index));
  const edges = [...new Set(kernel.locate(face, hit.shape, 'edge'))].filter((i) => i >= 0);
  for (const edge of edges) {
    // A seam (a cylinder meeting itself) bounds only this face: not an outline.
    const around = description.edges[edge]?.faces ?? [];
    if (around.length === 1 && around[0] === hit.index) continue;
    const curve = projectEdge(kernel.edgeGeometry(hit.shape, edge), frame);
    const key = names[edge] ?? `edge#${edge}`;
    if (curve) curves[key] = curve;
  }
  kernel.faceSilhouettes(hit.shape, hit.index, frame.normal).forEach((segment, i) => {
    const curve = projectSegment(segment, frame);
    if (curve) curves[`sil:${i}`] = curve;
  });
  return curves;
}

/** The sketch's lines (construction too) by entity ID, start to end (ADR-0029). */
export function sketchLines(data: SketchData): Record<SketchEntityId, readonly [Vec2, Vec2]> {
  const out: Record<SketchEntityId, readonly [Vec2, Vec2]> = {};
  for (const [id, e] of Object.entries(data.entities) as [SketchEntityId, SketchEntity][]) {
    if (e.type !== 'line') continue;
    const a = data.entities[e.start];
    const b = data.entities[e.end];
    if (a?.type === 'point' && b?.type === 'point') {
      out[id] = [
        [a.x, a.y],
        [b.x, b.y],
      ];
    }
  }
  return out;
}

/** The sketch's points by entity ID, in sketch coordinates (see `SketchOutputData.points`). */
export function sketchPoints(data: SketchData): Record<SketchEntityId, Vec2> {
  const out: Record<SketchEntityId, Vec2> = {};
  for (const [id, e] of Object.entries(data.entities) as [SketchEntityId, SketchEntity][]) {
    if (e.type === 'point') out[id] = [e.x, e.y];
  }
  return out;
}

/** The path-pattern form of every curve of a sketch (see `SketchOutputData.curves`). */
function sketchCurves(data: SketchData): Record<SketchEntityId, SketchPathCurve> {
  const out: Record<SketchEntityId, SketchPathCurve> = {};
  const point = (id: SketchEntityId): Vec2 | undefined => {
    const p = data.entities[id];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  for (const [id, e] of Object.entries(data.entities) as [SketchEntityId, SketchEntity][]) {
    if (e.type === 'circle') {
      const center = point(e.center);
      if (center) out[id] = { type: 'arc', center, radius: e.radius, from: 0, sweep: 2 * Math.PI };
    } else if (e.type === 'arc') {
      const [center, start, end] = [point(e.center), point(e.start), point(e.end)];
      if (!center || !start || !end) continue;
      const from = Math.atan2(start[1] - center[1], start[0] - center[0]);
      const to = Math.atan2(end[1] - center[1], end[0] - center[0]);
      let sweep = (to - from) % (2 * Math.PI);
      if (sweep <= 1e-12) sweep += 2 * Math.PI;
      out[id] = {
        type: 'arc',
        center,
        radius: Math.hypot(start[0] - center[0], start[1] - center[1]),
        from,
        sweep,
      };
    } else if (e.type !== 'point') {
      const points = curvePolyline(data, e);
      if (points) out[id] = { type: 'polyline', points };
    }
  }
  return out;
}

/** Every curve of a sketch, construction ones too, exact (see `SketchOutputData.exact`). */
function exactCurves(data: SketchData): Record<SketchEntityId, PlanarCurve> {
  const out: Record<SketchEntityId, PlanarCurve> = {};
  const point = (ref: SketchEntityId): Vec2 | undefined => {
    const p = data.entities[ref];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  for (const [id, e] of Object.entries(data.entities) as [SketchEntityId, SketchEntity][]) {
    if (e.type === 'point' || e.type === 'text') continue;
    const curve = planarCurve(e, point);
    if (curve) out[id] = curve;
  }
  return out;
}

const faceArea = (faces: readonly PlanarFace[], i: number) => (faces[i] as PlanarFace).area;

/** The text entities of a sketch, entity ID order, construction ones too (P4-03). */
function textsOf(data: SketchData): SketchEntityId[] {
  const out: SketchEntityId[] = [];
  for (const [id, e] of Object.entries(data.entities) as [SketchEntityId, SketchEntity][]) {
    if (e.type === 'text') out.push(id);
  }
  return out;
}

/** How much of a text's string a message shows before it shortens it. */
const SHORT_TEXT = 20;

/** A text's string for a message: the first 20 characters, with an ellipsis when it cuts. */
const shortText = (text: string) =>
  text.length > SHORT_TEXT ? `${text.slice(0, SHORT_TEXT)}…` : text;

/**
 * Warnings about a sketch's texts (P4-03, ADR-0058 §5): a font the worker
 * doesn't have, glyphs it lacks, and texts that draw nothing.
 */
function textWarnings(data: SketchData): string[] {
  const warnings: string[] = [];
  for (const [id, e] of Object.entries(data.entities) as [SketchEntityId, SketchEntity][]) {
    if (e.type !== 'text') continue;
    const placed = placeText(data, id);
    if (placed.status === 'no-font') {
      warnings.push(`Text "${shortText(e.text)}" uses font ${e.font}, which isn't available.`);
    } else if (placed.status === 'missing-glyphs') {
      warnings.push(
        `Font ${e.font} has no letters for "${placed.missing.join(', ')}"; they show as boxes.`,
      );
    } else if (placed.status === 'empty') {
      warnings.push(`Text "${shortText(e.text)}" has no letters to draw.`);
    }
  }
  return warnings;
}

/**
 * The sketch's curves for the kernel, in entity ID order (as
 * `detectProfiles` walks them), without points and construction geometry.
 * A text entity contributes its placed sub-curves in order, named by their
 * sub-IDs (`<text>.<k>`, ADR-0058 §2). `ids[i]` is the entity of
 * `curves[i]`.
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
    if (e.type === 'text') {
      for (const curve of placeText(data, id).curves) {
        curves.push(
          curve.kind === 'line'
            ? { kind: 'line', a: curve.a, b: curve.b }
            : { kind: 'spline', degree: curve.degree, poles: curve.poles, knots: curve.knots },
        );
        ids.push(curve.id as SketchEntityId);
      }
      continue;
    }
    const curve = planarCurve(e, point);
    if (!curve) continue;
    curves.push(curve);
    ids.push(id);
  }
  return { curves, ids };
}

function planarCurve(
  e: Exclude<SketchEntity, { type: 'point' | 'text' }>,
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
 * profiles the sketch shows and a user selects. `textOf` maps a region ID
 * to the text entity whose ink it is (P4-03, ADR-0058 §5).
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
): { ids: string[]; reassigned: number; textOf: Map<string, SketchEntityId> } {
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
    ...(p.text && { text: p.text }),
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
  const textOf = new Map<string, SketchEntityId>(
    detected.flatMap((p) => (p.text ? [[p.id, p.text as SketchEntityId] as const] : [])),
  );
  return { ids: ids as string[], reassigned, textOf };
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
