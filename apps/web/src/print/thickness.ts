/**
 * Wall-thickness check (P5-06, ADR-0072, FR-3DP-07): where a printed wall is thinner than a
 * minimum, before exporting. Pure maths over the display meshes (`BodyMesh`), no kernel call:
 * for each triangle, the distance from its centroid along the inward normal to the first hit
 * on the same body's mesh (the far side of the wall). The view colours the thin triangles
 * (`viewport/thicknessShading.ts`), marks the thinnest spot and the panel and the tests read
 * the counts from here.
 *
 * **Thickness is a ray measure** (ADR-0072 §1): the ray starts at the triangle's centroid
 * moved `1e-4 mm` inward (so it never hits the triangle it starts on), along the triangle's
 * own inward normal. Exact for parallel walls; at a wedge it is the real local thickness along
 * that normal. A ray that hits nothing (an open or bad mesh) gives `NaN` and is never flagged.
 * A triangle is **thin** when its thickness is below the minimum (a wall exactly at it is fine).
 *
 * The rays are cast once per body mesh and cached by the mesh's identity (`measureThickness`);
 * a changed minimum only re-classifies. `measureTriangles` fills a run of triangles — the
 * chunked path for meshes too big to measure in one go (the hook slices across animation
 * frames) — and `rememberThickness` puts such a result in the cache.
 */
import type { BodyId } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { DoubleSide, Ray, Vector3 } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

/** How far inside the surface a ray starts (mm), so it never hits its own triangle. */
export const RAY_EPS = 1e-4;

/** The wall-thickness analysis as the viewport stores it (view state, like the overhang's). */
export interface ThicknessState {
  /** A length expression: the minimum wall thickness ("0.9 mm", "2 * tolerance"). */
  min: string;
  /** The view is shaded and the thinnest spot marked. */
  on: boolean;
}

/** What one body's triangles come to (`classifyThickness`). */
export interface ThicknessClass {
  /** Triangles below the minimum. */
  thin: number;
  /** mm² of them. */
  area: number;
  /** The thinnest measured triangle (`NaN` rays leave nothing). */
  thinnest: { value: number; triangle: number } | undefined;
}

/** The thinnest measured spot of a body, where the marker's leader starts. */
export interface ThinSpot {
  value: number;
  body: BodyId;
  triangle: number;
  /** The triangle's centroid, world mm. */
  point: readonly [number, number, number];
}

export interface ThicknessReport {
  bodies: Record<BodyId, ThicknessClass>;
  /** Bodies measured (the shown ones: hidden bodies are neither measured nor counted). */
  measured: number;
  /** Bodies with at least one thin triangle (the panel's "in 2 bodies"). */
  thinBodies: number;
  /** Thin triangles over every body. */
  thin: number;
  /** mm² of them. */
  area: number;
  /** The thinnest measured spot over every body: what the marker and `thinnest=` show. */
  thinnest: ThinSpot | undefined;
}

// ---------------------------------------------------------------------------- measure --

const cache = new WeakMap<BodyMesh, Float32Array>();
let rays = 0;

/** Rays cast through `measureTriangles` (tests: a cached call casts none). */
export function thicknessRays(): number {
  return rays;
}

/** How many triangles a mesh has. */
export function triangleCount(mesh: BodyMesh): number {
  return mesh.indices.length / 3;
}

/**
 * Measures every triangle of one body (cached by the mesh's identity, so a new recompute's
 * new mesh measures again and a changed minimum does not). One value per triangle: the
 * distance in mm from the triangle along its inward normal to the first hit on the same mesh,
 * `NaN` where the ray hits nothing.
 */
export function measureThickness(mesh: BodyMesh, bvh: MeshBVH): Float32Array {
  const found = cache.get(mesh);
  if (found) return found;
  const out = new Float32Array(triangleCount(mesh)).fill(NaN);
  measureTriangles(mesh, bvh, out, 0, out.length);
  cache.set(mesh, out);
  return out;
}

/** What a previous measurement of this mesh found, without casting any ray. */
export function cachedThickness(mesh: BodyMesh): Float32Array | undefined {
  return cache.get(mesh);
}

/** Caches what a chunked measurement built, so `measureThickness` finds it. */
export function rememberThickness(mesh: BodyMesh, values: Float32Array): void {
  cache.set(mesh, values);
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const ab = new Vector3();
const ac = new Vector3();
const inward = new Vector3();
const ray = new Ray();

/**
 * Measures the triangles `[from, from + count)` into `out` (the raw work under
 * `measureThickness`, and the chunk the big-mesh path fills across animation frames).
 */
export function measureTriangles(
  mesh: BodyMesh,
  bvh: MeshBVH,
  out: Float32Array,
  from: number,
  count: number,
): void {
  const { positions: p, indices } = mesh;
  const last = Math.min(from + count, out.length);
  for (let t = from; t < last; t++) {
    const i = 3 * (indices[3 * t] as number);
    const j = 3 * (indices[3 * t + 1] as number);
    const k = 3 * (indices[3 * t + 2] as number);
    a.set(p[i] as number, p[i + 1] as number, p[i + 2] as number);
    b.set(p[j] as number, p[j + 1] as number, p[j + 2] as number);
    c.set(p[k] as number, p[k + 1] as number, p[k + 2] as number);
    // The centroid of the triangle, and its own inward normal (wound counter-clockwise
    // seen from outside, so the cross product points out of the solid).
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    inward.crossVectors(ab, ac);
    const area2 = inward.length();
    if (!(area2 > 0)) {
      out[t] = Number.NaN;
      continue;
    }
    inward.multiplyScalar(-1 / area2);
    ray.origin.set(cx + inward.x * RAY_EPS, cy + inward.y * RAY_EPS, cz + inward.z * RAY_EPS);
    ray.direction.copy(inward);
    rays++;
    const hit = bvh.raycastFirst(ray, DoubleSide, 0, Number.POSITIVE_INFINITY);
    out[t] = hit ? hit.distance + RAY_EPS : Number.NaN;
  }
}

/** The area of every triangle, mm². */
export function triangleAreas(mesh: BodyMesh): Float32Array {
  const { positions: p, indices } = mesh;
  const out = new Float32Array(triangleCount(mesh));
  for (let t = 0; t < out.length; t++) {
    const i = 3 * (indices[3 * t] as number);
    const j = 3 * (indices[3 * t + 1] as number);
    const k = 3 * (indices[3 * t + 2] as number);
    a.set(p[i] as number, p[i + 1] as number, p[i + 2] as number);
    b.set(p[j] as number, p[j + 1] as number, p[j + 2] as number);
    c.set(p[k] as number, p[k + 1] as number, p[k + 2] as number);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    out[t] = inward.crossVectors(ab, ac).length() / 2;
  }
  return out;
}

/** The centroid of one triangle, world mm (where the thinnest spot's marker stands). */
export function triangleCenter(
  mesh: BodyMesh,
  triangle: number,
): readonly [number, number, number] {
  const { positions: p, indices } = mesh;
  const i = 3 * (indices[3 * triangle] as number);
  const j = 3 * (indices[3 * triangle + 1] as number);
  const k = 3 * (indices[3 * triangle + 2] as number);
  return [
    ((p[i] as number) + (p[j] as number) + (p[k] as number)) / 3,
    ((p[i + 1] as number) + (p[j + 1] as number) + (p[k + 1] as number)) / 3,
    ((p[i + 2] as number) + (p[j + 2] as number) + (p[k + 2] as number)) / 3,
  ];
}

// -------------------------------------------------------------------------- classify --

/**
 * Counts what is below `min`: the thin triangles, their area and the thinnest measured one
 * (whether or not it is thin — when anything is thin, the thinnest is). Rays that hit nothing
 * (`NaN`) are neither thinnest nor thin.
 */
export function classifyThickness(
  values: Float32Array,
  areas: Float32Array,
  min: number,
): ThicknessClass {
  let thin = 0;
  let area = 0;
  let thinnest: ThicknessClass['thinnest'];
  for (let t = 0; t < values.length; t++) {
    const value = values[t] as number;
    if (Number.isNaN(value)) continue;
    if (!thinnest || value < thinnest.value) thinnest = { value, triangle: t };
    if (value < min) {
      thin++;
      area += areas[t] ?? 0;
    }
  }
  return { thin, area, thinnest };
}

/** The report over every measured body (`values` per body, as `measureThickness` gives). */
export function thicknessReport(
  items: readonly { id: BodyId; mesh: BodyMesh; values: Float32Array }[],
  min: number,
): ThicknessReport {
  const bodies: Record<BodyId, ThicknessClass> = {};
  let measured = 0;
  let thinBodies = 0;
  let thin = 0;
  let area = 0;
  let thinnest: ThinSpot | undefined;
  for (const { id, mesh, values } of items) {
    const body = classifyThickness(values, triangleAreas(mesh), min);
    bodies[id] = body;
    measured++;
    if (body.thin > 0) thinBodies++;
    thin += body.thin;
    area += body.area;
    if (body.thinnest && (!thinnest || body.thinnest.value < thinnest.value)) {
      thinnest = {
        value: body.thinnest.value,
        body: id,
        triangle: body.thinnest.triangle,
        point: triangleCenter(mesh, body.thinnest.triangle),
      };
    }
  }
  return { bodies, measured, thinBodies, thin, area, thinnest };
}

/**
 * Per-node flags for the shading (`viewport/thicknessShading.ts`): 1 on the nodes of a thin
 * triangle, 0 elsewhere. Nodes are shared inside a face, so where thin meets thick the value
 * is 1 — the shader cuts the boundary at half, one triangle wide.
 */
export function thinAttribute(mesh: BodyMesh, values: Float32Array, min: number): Float32Array {
  const out = new Float32Array(mesh.positions.length / 3);
  const { indices } = mesh;
  for (let t = 0; t < values.length; t++) {
    const value = values[t] as number;
    if (Number.isNaN(value) || value >= min) continue;
    out[indices[3 * t] as number] = 1;
    out[indices[3 * t + 1] as number] = 1;
    out[indices[3 * t + 2] as number] = 1;
  }
  return out;
}

/** The default minimum (ADR-0072 §2): two line widths of the `print.material` preference. */
export function defaultMinimum(lineWidth: number): string {
  return `${Math.round(lineWidth * 2 * 1000) / 1000} mm`;
}

/**
 * The analysis for tests (`data-thickness` on the Viewport region):
 * "min=0.9 thin=12 area=226 thinnest=0.8 bodies=1", the minimum as the expression's value;
 * `… off` while the shading is off, `pending` while big meshes are still being measured.
 * `bodies` counts the measured ones (hidden bodies are not counted).
 */
export function thicknessSummary(
  state: ThicknessState,
  min: number | undefined,
  report: ThicknessReport | undefined,
  pending = false,
): string {
  const base = `min=${min === undefined ? '?' : round(min)}`;
  if (!state.on) return `${base} off`;
  if (pending) return `${base} pending`;
  if (!report) return `${base} off`;
  return `${base} thin=${report.thin} area=${round(report.area)} thinnest=${
    report.thinnest ? round(report.thinnest.value) : 'none'
  } bodies=${report.measured}`;
}

const round = (x: number) => `${Math.round(x * 10) / 10 + 0}`;
