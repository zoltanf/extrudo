/**
 * Picking in model mode (P2-03, FR-VP-05, architecture §5.4, ADR-0026):
 * what lies under the pointer, and what a selection box takes. Pure
 * functions of the scene and the camera, in world mm and view pixels, so
 * they run in unit tests without WebGL.
 *
 * - **Faces** by a ray cast into each body's mesh (three-mesh-bvh: one BVH
 *   per mesh, built on first use and kept with the mesh).
 * - **Edges and vertices** by their screen distance from the pointer: the
 *   closest approach between the pick ray and each edge segment or vertex,
 *   in pixels at that depth.
 * - **Occlusion:** an item is hidden if a face lies between the camera and
 *   it (a second ray cast, towards its nearest point). Hidden items are only
 *   offered by "Select other…".
 * - **Sketch curves and profiles** where the ray meets their plane, with
 *   the sketch-mode rules (`pickEntity`, `profileAt`).
 */
import {
  type BodyId,
  entityPolylines,
  type FeatureId,
  profileRefId,
  type SelectionItem,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type SketchFrame,
  sketchEntityRefId,
  sketchToWorld,
  type Vec2,
  worldToSketch,
} from '@extrudo/core';
import { type BodyMesh, EDGE_SEAM } from '@extrudo/kernel';
import { pickEntity } from '@extrudo/sketch/inference';
import { type Profile, profileAt } from '@extrudo/sketch/profiles';
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { clipDistance, isClipped, type SectionClip } from '../section/clip';
import {
  basis,
  cameraPosition,
  orthographicDistance,
  type Projection,
  perspectiveDistance,
  rayPlane,
  shiftOf,
  type View,
  viewRay,
} from '../viewport/camera';
import type { FilterKind, SelectionFilter } from './filter';
import { topologyItem } from './items';

/** A vertex within this many pixels of the pointer wins over everything else. */
export const VERTEX_PX = 8;
/** An edge or a sketch curve within this many pixels is under the pointer. */
export const EDGE_PX = 6;
/** Occlusion slack, in pixels of depth: an edge on a face isn't hidden by that face. */
const OCCLUSION_PX = 1.5;
/** "Select other…" lists at most this many items. */
export const STACK_LIMIT = 24;

export interface PickCamera {
  view: View;
  projection: Projection;
  /** The view's size in CSS pixels. */
  width: number;
  height: number;
}

export interface PickBody {
  id: BodyId;
  mesh: BodyMesh;
}

export interface PickSketch {
  id: FeatureId;
  frame: SketchFrame;
  data: SketchData;
  /** Shaded profiles; none while "Show profiles" is off. */
  profiles?: readonly Profile[];
}

/** A drawn origin axis (P2-07): picked like an edge, as `{ kind: 'axis', id }`. */
export interface PickAxis {
  /** The reference ID: `origin:x`, `origin:y`, `origin:z`. */
  id: string;
  /** Its centre (the origin) and unit direction, world mm. */
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
  /** How far it is drawn each way from `origin`, mm. */
  half: number;
}

/** A drawn construction plane (P3-05): picked where the ray meets its square. */
export interface PickPlane {
  /** The reference ID: the construction feature's ID. */
  id: string;
  frame: SketchFrame;
  /** The centre of the square drawn, a point of the plane. */
  anchor: readonly [number, number, number];
  /** Half the square's side, mm. */
  half: number;
}

/** A drawn construction point (P3-05): picked like a vertex, as `{ kind: 'point', id }`. */
export interface PickPoint {
  id: string;
  at: readonly [number, number, number];
}

export interface PickScene {
  /** Visible bodies. */
  bodies: readonly PickBody[];
  /** Drawn sketches. */
  sketches: readonly PickSketch[];
  /** Drawn origin axes and construction axes (the `construction` filter kind); none when absent. */
  axes?: readonly PickAxis[];
  /** Drawn construction planes and points (P3-05); none when absent. */
  planes?: readonly PickPlane[];
  points?: readonly PickPoint[];
  /** Faces are drawn (not wireframe), so they hide what is behind them. */
  occluding: boolean;
  /**
   * A section analysis (P3-09): what lies on the clipped side isn't drawn, so it is never
   * picked, and the caps drawn on the cut hide what is behind them.
   */
  clip?: SectionClip;
}

export interface PickHit {
  item: SelectionItem;
  /** Distance along the pick ray, mm. */
  depth: number;
  /** Screen distance from the pointer, px: 0 for faces, profiles and bodies under it. */
  px: number;
  /** Behind a face: only "Select other…" offers it. */
  occluded: boolean;
}

// Per-mesh caches ----------------------------------------------------------------

interface MeshIndex {
  bvh: MeshBVH;
  /** The face of each triangle. */
  triangleFace: Uint32Array;
}

const meshIndex = new WeakMap<BodyMesh, MeshIndex>();

/** The BVH and triangle → face map of a mesh, built once per mesh. */
function indexOf(mesh: BodyMesh): MeshIndex {
  let index = meshIndex.get(mesh);
  if (!index) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geometry.setIndex(new BufferAttribute(mesh.indices, 1));
    // Indirect: the BVH keeps its own triangle order and leaves the index (shared with
    // the rendered geometry) alone; hits still report the original triangle.
    const bvh = new MeshBVH(geometry, { indirect: true });
    index = { bvh, triangleFace: triangleFaces(mesh) };
    meshIndex.set(mesh, index);
  }
  return index;
}

/** The face each triangle belongs to (`faceRanges`). */
export function triangleFaces(mesh: BodyMesh): Uint32Array {
  const out = new Uint32Array(mesh.indices.length / 3);
  for (let f = 0; f < mesh.faceRanges.length >> 1; f++) {
    const first = mesh.faceRanges[2 * f] ?? 0;
    const count = mesh.faceRanges[2 * f + 1] ?? 0;
    out.fill(f, first, Math.min(out.length, first + count));
  }
  return out;
}

// Camera helpers ------------------------------------------------------------------

interface Eye {
  camera: PickCamera;
  ray: Ray;
  /** World mm per pixel on the target plane. */
  perPixel: number;
  /** Camera position (perspective) and view direction. */
  eye: Vector3;
  forward: Vector3;
  focal: number;
}

function eyeFor(camera: PickCamera, at: readonly [number, number]): Eye {
  const { view, projection, width, height } = camera;
  const ndc: [number, number] = [(at[0] / width) * 2 - 1, 1 - (at[1] / height) * 2];
  const r = viewRay(view, projection, width / height, ndc);
  return {
    camera,
    ray: new Ray(r.origin, r.direction),
    perPixel: view.size / Math.max(1, height),
    eye: cameraPosition(view, projection),
    forward: basis(view).back.negate(),
    focal: perspectiveDistance(view.size),
  };
}

/** World mm per screen pixel at a point (grows with depth in perspective). */
function perPixelAt(e: Eye, x: number, y: number, z: number): number {
  if (e.camera.projection === 'orthographic') return e.perPixel;
  const depth =
    (x - e.eye.x) * e.forward.x + (y - e.eye.y) * e.forward.y + (z - e.eye.z) * e.forward.z;
  return (e.perPixel * Math.max(depth, 1e-6)) / e.focal;
}

const scratch = { origin: new Vector3(), direction: new Vector3(), ray: new Ray() };

/** Whether a drawn face lies between the camera and the point. */
function hidden(e: Eye, scene: PickScene, x: number, y: number, z: number): boolean {
  if (!scene.occluding) return false;
  const { ray } = scratch;
  let length: number;
  if (e.camera.projection === 'orthographic') {
    ray.direction.copy(e.forward);
    length = orthographicDistance(e.camera.view) * 2;
    ray.origin.set(x, y, z).addScaledVector(ray.direction, -length);
  } else {
    ray.origin.copy(e.eye);
    ray.direction.set(x - e.eye.x, y - e.eye.y, z - e.eye.z);
    length = ray.direction.length();
    if (length < 1e-9) return false;
    ray.direction.divideScalar(length);
  }
  const far = length - OCCLUSION_PX * perPixelAt(e, x, y, z);
  if (far <= 0) return false;
  for (const body of scene.bodies) {
    if (keptHit(indexOf(body.mesh).bvh, ray, far, scene.clip)) return true;
  }
  // A cap on the cut lies between the camera and the point.
  return scene.clip !== undefined && capDepth(scene, ray, far) !== undefined;
}

/** Whether the ray meets a face within `far`, ignoring what a section clips away. */
function keptHit(bvh: MeshBVH, ray: Ray, far: number, clip: SectionClip | undefined): boolean {
  if (!clip) return bvh.raycastFirst(ray, DoubleSide, 0, far) !== null;
  return bvh
    .raycast(ray, DoubleSide, 0, far)
    .some((hit) => !isClipped(clip, hit.point.x, hit.point.y, hit.point.z));
}

/**
 * Where the ray meets the cap of a section within `far`, if it does (P3-09): the ray runs from
 * the clipped side through the plane into a body, so the plane is covered there (the first face
 * behind it is one seen from the inside). Undefined when nothing is capped along the ray.
 */
function capDepth(scene: PickScene, ray: Ray, far: number): number | undefined {
  const clip = scene.clip;
  if (!clip) return undefined;
  const n = clip.normal;
  const slope = -(ray.direction.x * n[0] + ray.direction.y * n[1] + ray.direction.z * n[2]);
  const start = clipDistance(clip, ray.origin.x, ray.origin.y, ray.origin.z);
  // Only a ray that starts on the clipped side and heads for the plane crosses it there.
  if (start <= 0 || slope <= 1e-9) return undefined;
  const t = start / slope;
  if (t >= far) return undefined;
  for (const body of scene.bodies) {
    const hit = indexOf(body.mesh).bvh.raycastFirst(ray, DoubleSide, t + 1e-7, Infinity);
    if (!hit || hit.faceIndex == null) continue;
    const { normals, indices } = body.mesh;
    const v = 3 * (indices[3 * hit.faceIndex] ?? 0);
    const facing =
      ray.direction.x * (normals[v] ?? 0) +
      ray.direction.y * (normals[v + 1] ?? 0) +
      ray.direction.z * (normals[v + 2] ?? 0);
    // Leaving the solid: the ray was inside it when it crossed the plane.
    if (facing > 0) return t;
  }
  return undefined;
}

// Pointer picking -----------------------------------------------------------------

interface Near {
  item: SelectionItem;
  px: number;
  depth: number;
  at: [number, number, number];
}

/** Every face the ray passes through: the nearest hit per face. */
function faceHits(e: Eye, scene: PickScene) {
  const out: { body: BodyId; face: number; depth: number }[] = [];
  for (const body of scene.bodies) {
    const { bvh, triangleFace } = indexOf(body.mesh);
    const nearest = new Map<number, number>();
    for (const hit of bvh.raycast(e.ray, DoubleSide)) {
      if (scene.clip && isClipped(scene.clip, hit.point.x, hit.point.y, hit.point.z)) continue;
      const face = triangleFace[hit.faceIndex ?? 0] ?? 0;
      const seen = nearest.get(face);
      if (seen === undefined || hit.distance < seen) nearest.set(face, hit.distance);
    }
    for (const [face, depth] of nearest) out.push({ body: body.id, face, depth });
  }
  return out.sort((a, b) => a.depth - b.depth);
}

/** Edges near the pointer: the closest approach of the ray to each edge's polyline. */
function nearEdges(e: Eye, scene: PickScene): Near[] {
  const out: Near[] = [];
  const { origin: o, direction: d } = e.ray;
  for (const body of scene.bodies) {
    const { edgePoints: p, edgeRanges, edgeFlags } = body.mesh;
    for (let edge = 0; edge < edgeRanges.length >> 1; edge++) {
      if (((edgeFlags[edge] ?? 0) & EDGE_SEAM) !== 0) continue;
      const first = edgeRanges[2 * edge] ?? 0;
      const count = edgeRanges[2 * edge + 1] ?? 0;
      let best: Near | undefined;
      for (let i = first; i + 1 < first + count; i++) {
        const ax = p[3 * i] ?? 0;
        const ay = p[3 * i + 1] ?? 0;
        const az = p[3 * i + 2] ?? 0;
        const vx = (p[3 * i + 3] ?? 0) - ax;
        const vy = (p[3 * i + 4] ?? 0) - ay;
        const vz = (p[3 * i + 5] ?? 0) - az;
        const wx = o.x - ax;
        const wy = o.y - ay;
        const wz = o.z - az;
        const b = d.x * vx + d.y * vy + d.z * vz;
        const c = vx * vx + vy * vy + vz * vz;
        const dw = d.x * wx + d.y * wy + d.z * wz;
        const vw = vx * wx + vy * wy + vz * wz;
        const denom = c - b * b;
        let u = denom > 1e-12 * Math.max(c, 1) ? (vw - b * dw) / denom : 0;
        u = Math.min(1, Math.max(0, u));
        let s = u * b - dw;
        if (s < 0) {
          s = 0;
          u = c > 0 ? Math.min(1, Math.max(0, vw / c)) : 0;
        }
        const qx = ax + u * vx;
        const qy = ay + u * vy;
        const qz = az + u * vz;
        const dist = Math.hypot(o.x + s * d.x - qx, o.y + s * d.y - qy, o.z + s * d.z - qz);
        const px = dist / perPixelAt(e, qx, qy, qz);
        if (scene.clip && isClipped(scene.clip, qx, qy, qz)) continue;
        if (px <= EDGE_PX && (!best || px < best.px)) {
          best = {
            item: topologyItem({ kind: 'edge', body: body.id, index: edge }),
            px,
            depth: s,
            at: [qx, qy, qz],
          };
        }
      }
      if (best) out.push(best);
    }
  }
  return out;
}

/** B-rep vertices near the pointer. */
function nearVertices(e: Eye, scene: PickScene): Near[] {
  const out: Near[] = [];
  const { origin: o, direction: d } = e.ray;
  for (const body of scene.bodies) {
    const v = body.mesh.vertices;
    for (let i = 0; i + 2 < v.length; i += 3) {
      const x = v[i] ?? 0;
      const y = v[i + 1] ?? 0;
      const z = v[i + 2] ?? 0;
      const s = (x - o.x) * d.x + (y - o.y) * d.y + (z - o.z) * d.z;
      if (s < 0 || (scene.clip && isClipped(scene.clip, x, y, z))) continue;
      const dist = Math.hypot(o.x + s * d.x - x, o.y + s * d.y - y, o.z + s * d.z - z);
      const px = dist / perPixelAt(e, x, y, z);
      if (px <= VERTEX_PX) {
        out.push({
          item: topologyItem({ kind: 'vertex', body: body.id, index: i / 3 }),
          px,
          depth: s,
          at: [x, y, z],
        });
      }
    }
  }
  return out;
}

/** Origin axes near the pointer: the closest approach of the ray to each drawn axis. */
function nearAxes(e: Eye, scene: PickScene): Near[] {
  const out: Near[] = [];
  const { origin: o, direction: d } = e.ray;
  for (const axis of scene.axes ?? []) {
    const [ox, oy, oz] = axis.origin;
    const [ux, uy, uz] = axis.direction;
    // Closest points of the ray o + s·d and the axis p + t·u, t within ±half.
    const wx = o.x - ox;
    const wy = o.y - oy;
    const wz = o.z - oz;
    const b = d.x * ux + d.y * uy + d.z * uz;
    const dw = d.x * wx + d.y * wy + d.z * wz;
    const uw = ux * wx + uy * wy + uz * wz;
    const denom = 1 - b * b;
    let t = denom > 1e-12 ? (uw - b * dw) / denom : uw;
    t = Math.max(-axis.half, Math.min(axis.half, t));
    const qx = ox + t * ux;
    const qy = oy + t * uy;
    const qz = oz + t * uz;
    const s = Math.max(0, (qx - o.x) * d.x + (qy - o.y) * d.y + (qz - o.z) * d.z);
    const dist = Math.hypot(o.x + s * d.x - qx, o.y + s * d.y - qy, o.z + s * d.z - qz);
    const px = dist / perPixelAt(e, qx, qy, qz);
    if (px <= EDGE_PX) {
      out.push({ item: { kind: 'axis', id: axis.id }, px, depth: s, at: [qx, qy, qz] });
    }
  }
  return out;
}

/** Construction points near the pointer, like vertices. */
function nearPoints(e: Eye, scene: PickScene): Near[] {
  const out: Near[] = [];
  const { origin: o, direction: d } = e.ray;
  for (const point of scene.points ?? []) {
    const [x, y, z] = point.at;
    const s = (x - o.x) * d.x + (y - o.y) * d.y + (z - o.z) * d.z;
    if (s < 0) continue;
    const dist = Math.hypot(o.x + s * d.x - x, o.y + s * d.y - y, o.z + s * d.z - z);
    const px = dist / perPixelAt(e, x, y, z);
    if (px <= VERTEX_PX)
      out.push({ item: { kind: 'point', id: point.id }, px, depth: s, at: [x, y, z] });
  }
  return out;
}

/** Construction planes under the pointer: where the ray meets each drawn square. */
function planeHits(e: Eye, scene: PickScene): { item: SelectionItem; depth: number }[] {
  const out: { item: SelectionItem; depth: number }[] = [];
  const ray = { origin: e.ray.origin, direction: e.ray.direction };
  for (const plane of scene.planes ?? []) {
    const hit = rayPlane(ray, plane.frame.origin, plane.frame.normal);
    if (!hit) continue;
    const u =
      (hit.x - plane.anchor[0]) * plane.frame.x[0] +
      (hit.y - plane.anchor[1]) * plane.frame.x[1] +
      (hit.z - plane.anchor[2]) * plane.frame.x[2];
    const v =
      (hit.x - plane.anchor[0]) * plane.frame.y[0] +
      (hit.y - plane.anchor[1]) * plane.frame.y[1] +
      (hit.z - plane.anchor[2]) * plane.frame.y[2];
    if (Math.abs(u) > plane.half || Math.abs(v) > plane.half) continue;
    out.push({ item: { kind: 'plane', id: plane.id }, depth: hit.distanceTo(e.ray.origin) });
  }
  return out.sort((a, b) => a.depth - b.depth);
}

/**
 * Whether a sketch entity may be picked with this filter: curves through
 * `sketches` (construction ones through `construction`), points only while
 * a dialog's field asks for them (`sketchPoints`, P3-04).
 */
function acceptsEntity(filter: SelectionFilter) {
  return (entity: SketchEntity) =>
    entity.type === 'point'
      ? filter.sketchPoints
      : filter.sketches && (!entity.construction || filter.construction);
}

/** Sketch curves and profiles where the ray meets each sketch's plane. */
function sketchHits(e: Eye, scene: PickScene, filter: SelectionFilter) {
  const curves: Near[] = [];
  const profiles: Near[] = [];
  /** The whole texts under the pointer, one pick each however many letters (P4-03). */
  const texts: Near[] = [];
  const taken = new Set<string>();
  for (const sketch of scene.sketches) {
    const hit = rayPlane(
      { origin: e.ray.origin, direction: e.ray.direction },
      sketch.frame.origin,
      sketch.frame.normal,
    );
    if (!hit) continue;
    const depth = hit.distanceTo(e.ray.origin);
    const at: [number, number, number] = [hit.x, hit.y, hit.z];
    const point = worldToSketch(sketch.frame, at);
    const perPixel = perPixelAt(e, ...at);
    if (filter.sketches || filter.sketchPoints) {
      const reach = (filter.sketchPoints ? VERTEX_PX : EDGE_PX) * perPixel;
      const id = pickEntity(sketch.data, point, reach, acceptsEntity(filter));
      if (id) {
        const px = curveDistance(sketch.data, id, point) / perPixel;
        curves.push({
          item: { kind: 'sketchEntity', id: sketchEntityRefId(sketch.id, id) },
          px,
          depth,
          at,
        });
      }
    }
    if (filter.profiles && sketch.profiles) {
      const profile = profileAt(sketch.profiles, point);
      if (profile) {
        profiles.push({
          item: { kind: 'profile', id: profileRefId(sketch.id, profile.id) },
          px: 0,
          depth,
          at,
        });
        // Ink belongs to a text (P4-03, ADR-0058 §5): a click takes the whole
        // text, and "Select other…" still offers the single letter.
        if (profile.text && !taken.has(profile.text)) {
          taken.add(profile.text);
          texts.push({
            item: { kind: 'sketchEntity', id: sketchEntityRefId(sketch.id, profile.text) },
            px: 0,
            depth,
            at,
          });
        }
      }
    }
  }
  return { curves, profiles, texts };
}

/** How far `p` is from a sketch entity: the nearest of its polylines (P4-03 gives a text many). */
function curveDistance(data: SketchData, id: SketchEntityId, p: Vec2): number {
  const entity = data.entities[id];
  if (!entity) return 0;
  if (entity.type === 'point') return Math.hypot(p[0] - entity.x, p[1] - entity.y);
  const lines = entityPolylines(data, entity, id);
  if (lines.length === 0) return 0;
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1] as Vec2;
      const [bx, by] = line[i] as Vec2;
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy;
      const t =
        len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - ax) * vx + (p[1] - ay) * vy) / len2));
      best = Math.min(best, Math.hypot(p[0] - ax - t * vx, p[1] - ay - t * vy));
    }
  }
  return best;
}

/**
 * Everything under the pointer at `at` (view px) that the filter allows,
 * in "Select other…" order: vertices, edges and sketch curves near the
 * pointer (nearest first, visible before hidden), then profiles and faces
 * front to back (a profile before a face it lies on), then origin axes
 * near the pointer (they run through the model, so a face or profile under
 * the pointer wins; P2-07), then bodies front to back. At most
 * `STACK_LIMIT` items.
 */
export function pickStack(
  scene: PickScene,
  camera: PickCamera,
  at: readonly [number, number],
  filter: SelectionFilter,
): PickHit[] {
  if (camera.width <= 0 || camera.height <= 0) return [];
  const e = eyeFor(camera, at);
  const faces = faceHits(e, scene);
  // A cap on the cut hides what lies behind it, as a face does.
  const cap = scene.occluding ? capDepth(scene, e.ray, Infinity) : undefined;
  const nearest = faces[0]?.depth;
  const front =
    scene.occluding && (nearest !== undefined || cap !== undefined)
      ? Math.min(nearest ?? Infinity, cap ?? Infinity)
      : undefined;
  const slack = (depth: number) => {
    const p = e.ray.at(depth, new Vector3());
    return OCCLUSION_PX * perPixelAt(e, p.x, p.y, p.z);
  };
  const behind = (depth: number) => front !== undefined && depth > front + slack(front);

  const near = (items: Near[]): PickHit[] =>
    items
      .map((n) => ({
        item: n.item,
        depth: n.depth,
        px: n.px,
        occluded: hidden(e, scene, ...n.at),
      }))
      .sort((a, b) => Number(a.occluded) - Number(b.occluded) || a.px - b.px || a.depth - b.depth);

  const small: PickHit[] = [
    ...(filter.vertices ? near(nearVertices(e, scene)) : []),
    ...(filter.edges ? near(nearEdges(e, scene)) : []),
    // Construction points are picked like vertices (P3-05).
    ...(filter.construction ? near(nearPoints(e, scene)) : []),
  ];
  const sketches = sketchHits(e, scene, filter);
  small.push(...near(sketches.curves));
  // Origin axes run through the model: they come after profiles and faces (P2-07).
  const axes = filter.construction ? near(nearAxes(e, scene)) : [];
  // Construction planes: only where nothing but empty space or a body lies in front (P3-05).
  const planes: PickHit[] = filter.construction
    ? planeHits(e, scene).map((p) => ({ ...p, px: 0, occluded: behind(p.depth) }))
    : [];

  const areas: (PickHit & { rank: number })[] = [];
  // A whole text comes before the letter under the pointer (P4-03): it is what a
  // click takes, the letter region is what "Select other…" offers.
  for (const p of sketches.texts) {
    areas.push({ item: p.item, depth: p.depth, px: 0, occluded: behind(p.depth), rank: -1 });
  }
  for (const p of sketches.profiles) {
    areas.push({ item: p.item, depth: p.depth, px: 0, occluded: behind(p.depth), rank: 0 });
  }
  if (filter.faces) {
    for (const f of faces) {
      const item = topologyItem({ kind: 'face', body: f.body, index: f.face });
      areas.push({ item, depth: f.depth, px: 0, occluded: behind(f.depth), rank: 1 });
    }
  }
  // Coplanar (within the slack): the profile, drawn over the face, comes first.
  areas.sort((a, b) =>
    Math.abs(a.depth - b.depth) <= slack(Math.min(a.depth, b.depth))
      ? a.rank - b.rank
      : a.depth - b.depth,
  );

  const bodies: PickHit[] = [];
  if (filter.bodies) {
    const seen = new Set<BodyId>();
    for (const f of faces) {
      if (seen.has(f.body)) continue;
      seen.add(f.body);
      bodies.push({
        item: topologyItem({ kind: 'body', body: f.body, index: 0 }),
        depth: f.depth,
        px: 0,
        occluded: behind(f.depth),
      });
    }
  }

  // Visible small items first; hidden ones after the areas and bodies.
  const stack = [
    ...small.filter((h) => !h.occluded),
    ...areas.map(({ rank: _, ...hit }) => hit),
    ...axes.filter((h) => !h.occluded),
    ...planes.filter((h) => !h.occluded),
    ...bodies,
    ...small.filter((h) => h.occluded),
    ...axes.filter((h) => h.occluded),
    ...planes.filter((h) => h.occluded),
  ];
  return stack.slice(0, STACK_LIMIT);
}

/**
 * What a click at `at` takes (FR-VP-05): a vertex within `VERTEX_PX`, else
 * an edge or sketch curve within `EDGE_PX` (nearest first), else the front
 * profile or face, else the front body (when faces are filtered out).
 * Hidden items never; `undefined` over empty space.
 */
export function pickTop(
  scene: PickScene,
  camera: PickCamera,
  at: readonly [number, number],
  filter: SelectionFilter,
): SelectionItem | undefined {
  return pickStack(scene, camera, at, filter).find((h) => !h.occluded)?.item;
}

// Box selection -------------------------------------------------------------------

export type BoxMode = 'window' | 'crossing';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Projects world points to view pixels; `undefined` behind a perspective camera. */
function projector(camera: PickCamera) {
  const { view, projection, width, height } = camera;
  const { right, up, back } = basis(view);
  const half = view.size / 2;
  const aspect = width / height;
  const eye = cameraPosition(view, projection);
  const focal = perspectiveDistance(view.size);
  const [tx, ty, tz] = view.target;
  const shift = shiftOf(view);
  return (x: number, y: number, z: number): [number, number] | undefined => {
    let nx: number;
    let ny: number;
    if (projection === 'orthographic') {
      const rx = x - tx;
      const ry = y - ty;
      const rz = z - tz;
      nx = (rx * right.x + ry * right.y + rz * right.z) / (half * aspect);
      ny = (rx * up.x + ry * up.y + rz * up.z) / half;
    } else {
      const rx = x - eye.x;
      const ry = y - eye.y;
      const rz = z - eye.z;
      const depth = -(rx * back.x + ry * back.y + rz * back.z);
      if (depth <= 1e-9) return undefined;
      const scale = (depth * half) / focal;
      nx = (rx * right.x + ry * right.y + rz * right.z) / (scale * aspect);
      ny = (rx * up.x + ry * up.y + rz * up.z) / scale;
    }
    return [((nx + shift + 1) / 2) * width, ((1 - ny) / 2) * height];
  };
}

/** Where a world point shows in the view, in px; `undefined` behind a perspective camera. */
export function projectPoint(
  camera: PickCamera,
  [x, y, z]: readonly [number, number, number],
): [number, number] | undefined {
  return projector(camera)(x, y, z);
}

const inside = (r: Rect, p: readonly [number, number]) =>
  p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;

/** Whether the segment a–b meets the rectangle (Liang–Barsky clipping). */
export function segmentMeetsRect(
  a: readonly [number, number],
  b: readonly [number, number],
  r: Rect,
): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a[0] - r.x0) &&
    clip(dx, r.x1 - a[0]) &&
    clip(-dy, a[1] - r.y0) &&
    clip(dy, r.y1 - a[1])
  );
}

function insideTriangle(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): boolean {
  const cross = (u: readonly [number, number], v: readonly [number, number]) =>
    (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
  const d1 = cross(a, b);
  const d2 = cross(b, c);
  const d3 = cross(c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Whether a polygon (closed or not) of view points lies wholly inside, or meets, the box. */
function polylineIn(points: readonly ([number, number] | undefined)[], r: Rect, mode: BoxMode) {
  if (points.length === 0) return false;
  if (mode === 'window') return points.every((p) => p !== undefined && inside(r, p));
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p && inside(r, p)) return true;
    const q = points[i + 1];
    if (p && q && segmentMeetsRect(p, q, r)) return true;
  }
  return false;
}

/** Projected mesh nodes of a body, two numbers per node (NaN behind the camera). */
function projectNodes(mesh: BodyMesh, project: ReturnType<typeof projector>) {
  const n = mesh.positions.length / 3;
  const out = new Float64Array(2 * n);
  const p = mesh.positions;
  for (let i = 0; i < n; i++) {
    const s = project(p[3 * i] ?? 0, p[3 * i + 1] ?? 0, p[3 * i + 2] ?? 0);
    out[2 * i] = s ? s[0] : Number.NaN;
    out[2 * i + 1] = s ? s[1] : Number.NaN;
  }
  return out;
}

/** Whether every node of a face is on the side a section clips away: nothing of it is drawn. */
function faceClipped(mesh: BodyMesh, face: number, clip: SectionClip): boolean {
  const first = mesh.faceRanges[2 * face] ?? 0;
  const count = mesh.faceRanges[2 * face + 1] ?? 0;
  const p = mesh.positions;
  for (let t = first; t < first + count; t++) {
    for (let k = 0; k < 3; k++) {
      const i = 3 * (mesh.indices[3 * t + k] ?? 0);
      if (!isClipped(clip, p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0)) return false;
    }
  }
  return true;
}

/** Whether every point of an edge (`count` points from `first`) is on the clipped side. */
function edgeClipped(mesh: BodyMesh, first: number, count: number, clip: SectionClip): boolean {
  const p = mesh.edgePoints;
  for (let k = first; k < first + count; k++) {
    if (!isClipped(clip, p[3 * k] ?? 0, p[3 * k + 1] ?? 0, p[3 * k + 2] ?? 0)) return false;
  }
  return count > 0;
}

/** Whether a face (its triangles) lies wholly inside the box (window) or meets it (crossing). */
function faceIn(mesh: BodyMesh, nodes: Float64Array, face: number, r: Rect, mode: BoxMode) {
  const first = mesh.faceRanges[2 * face] ?? 0;
  const count = mesh.faceRanges[2 * face + 1] ?? 0;
  if (count === 0) return false;
  const center: [number, number] = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  const at = (node: number): [number, number] | undefined => {
    const x = nodes[2 * node] ?? Number.NaN;
    return Number.isNaN(x) ? undefined : [x, nodes[2 * node + 1] ?? 0];
  };
  for (let t = first; t < first + count; t++) {
    const tri = [0, 1, 2].map((k) => at(mesh.indices[3 * t + k] ?? 0));
    if (mode === 'window') {
      if (!tri.every((p) => p !== undefined && inside(r, p))) return false;
      continue;
    }
    const [a, b, c] = tri;
    if (!a || !b || !c) continue;
    if (
      inside(r, a) ||
      segmentMeetsRect(a, b, r) ||
      segmentMeetsRect(b, c, r) ||
      segmentMeetsRect(c, a, r) ||
      insideTriangle(center, a, b, c)
    ) {
      return true;
    }
  }
  return mode === 'window';
}

/** The kinds a box tries, in order: it takes the first kind it finds anything of. */
export const BOX_ORDER: readonly FilterKind[] = [
  'bodies',
  'faces',
  'edges',
  'vertices',
  'profiles',
  'sketches',
];

/**
 * Box selection in model mode (UI spec §3.2): the box from `from` to `to`
 * (view px) is a **window** when dragged left to right (what lies wholly
 * inside) and **crossing** right to left (what it touches). It takes one
 * kind, the first in `BOX_ORDER` that the filter allows and the box finds
 * anything of, so a box around a part selects the part, and with bodies
 * filtered out, its faces. The box sees through faces, as in sketch mode.
 */
export function pickBox(
  scene: PickScene,
  camera: PickCamera,
  from: readonly [number, number],
  to: readonly [number, number],
  filter: SelectionFilter,
): SelectionItem[] {
  if (camera.width <= 0 || camera.height <= 0) return [];
  const mode: BoxMode = to[0] >= from[0] ? 'window' : 'crossing';
  const r: Rect = {
    x0: Math.min(from[0], to[0]),
    y0: Math.min(from[1], to[1]),
    x1: Math.max(from[0], to[0]),
    y1: Math.max(from[1], to[1]),
  };
  const project = projector(camera);
  const nodes = new Map<BodyMesh, Float64Array>();
  const nodesOf = (mesh: BodyMesh) => {
    let n = nodes.get(mesh);
    if (!n) {
      n = projectNodes(mesh, project);
      nodes.set(mesh, n);
    }
    return n;
  };
  const faceCount = (mesh: BodyMesh) => mesh.faceRanges.length >> 1;

  const kinds: Record<string, () => SelectionItem[]> = {
    bodies: () =>
      scene.bodies
        .filter(({ mesh }) => {
          const n = faceCount(mesh);
          if (n === 0) return false;
          const faces = Array.from({ length: n }, (_, f) => f);
          return mode === 'window'
            ? faces.every((f) => faceIn(mesh, nodesOf(mesh), f, r, mode))
            : faces.some((f) => faceIn(mesh, nodesOf(mesh), f, r, mode));
        })
        .map(({ id }) => topologyItem({ kind: 'body', body: id, index: 0 })),
    faces: () =>
      scene.bodies.flatMap(({ id, mesh }) =>
        Array.from({ length: faceCount(mesh) }, (_, f) => f)
          .filter((f) => !scene.clip || !faceClipped(mesh, f, scene.clip))
          .filter((f) => faceIn(mesh, nodesOf(mesh), f, r, mode))
          .map((f) => topologyItem({ kind: 'face', body: id, index: f })),
      ),
    edges: () =>
      scene.bodies.flatMap(({ id, mesh }) => {
        const out: SelectionItem[] = [];
        const { edgePoints: p, edgeRanges, edgeFlags } = mesh;
        for (let e = 0; e < edgeRanges.length >> 1; e++) {
          if (((edgeFlags[e] ?? 0) & EDGE_SEAM) !== 0) continue;
          const first = edgeRanges[2 * e] ?? 0;
          const count = edgeRanges[2 * e + 1] ?? 0;
          if (scene.clip && edgeClipped(mesh, first, count, scene.clip)) continue;
          const points = Array.from({ length: count }, (_, k) =>
            project(
              p[3 * (first + k)] ?? 0,
              p[3 * (first + k) + 1] ?? 0,
              p[3 * (first + k) + 2] ?? 0,
            ),
          );
          if (polylineIn(points, r, mode)) {
            out.push(topologyItem({ kind: 'edge', body: id, index: e }));
          }
        }
        return out;
      }),
    vertices: () =>
      scene.bodies.flatMap(({ id, mesh }) => {
        const out: SelectionItem[] = [];
        const v = mesh.vertices;
        for (let i = 0; i + 2 < v.length; i += 3) {
          if (scene.clip && isClipped(scene.clip, v[i] ?? 0, v[i + 1] ?? 0, v[i + 2] ?? 0))
            continue;
          const s = project(v[i] ?? 0, v[i + 1] ?? 0, v[i + 2] ?? 0);
          if (s && inside(r, s)) out.push(topologyItem({ kind: 'vertex', body: id, index: i / 3 }));
        }
        return out;
      }),
    profiles: () => {
      const out: SelectionItem[] = [];
      const texts = new Set<string>();
      for (const sketch of scene.sketches) {
        for (const profile of sketch.profiles ?? []) {
          const outline = profile.outer.polygon.map((q) =>
            project(...sketchToWorld(sketch.frame, q)),
          );
          if (!polylineIn([...outline, outline[0]], r, mode)) continue;
          // Ink of a text (P4-03): the box takes the whole text, once.
          if (profile.text && !texts.has(profile.text)) {
            texts.add(profile.text);
            out.push({ kind: 'sketchEntity', id: sketchEntityRefId(sketch.id, profile.text) });
          }
          out.push({ kind: 'profile', id: profileRefId(sketch.id, profile.id) });
        }
      }
      return out;
    },
    sketches: () =>
      scene.sketches.flatMap((sketch) => {
        const accept = acceptsEntity(filter);
        const out: SelectionItem[] = [];
        for (const [key, entity] of Object.entries(sketch.data.entities)) {
          if (!accept(entity)) continue;
          const entityId = key as SketchEntityId;
          // A text (P4-03) is taken whole: any of its glyph curves in the box takes it.
          const hit = entityPolylines(sketch.data, entity, entityId).some((line) =>
            polylineIn(
              line.map((q) => project(...sketchToWorld(sketch.frame, q))),
              r,
              mode,
            ),
          );
          if (hit) out.push({ kind: 'sketchEntity', id: sketchEntityRefId(sketch.id, entityId) });
        }
        return out;
      }),
  };
  for (const kind of BOX_ORDER) {
    if (!filter[kind]) continue;
    const items = kinds[kind]?.() ?? [];
    if (items.length > 0) return items;
  }
  return [];
}
