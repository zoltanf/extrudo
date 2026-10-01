/**
 * Overhang analysis (P3-10, ADR-0048, FR-3DP-03): which parts of the model face so far
 * downwards that a printer needs support under them. Pure maths over the display meshes
 * (`BodyMesh`), no kernel call; the view colours the same triangles in a shader
 * (`viewport/overhangShading.ts`), and the panel and the tests read the counts from here.
 *
 * The rule, for a "down" direction `d` (unit) and an angle N (default 45°): a triangle is an
 * **overhang** when its normal points more than N° below the horizontal, that is
 * `normal · d > sin N`. A flat ceiling (normal = d) is the worst case; a wall (normal square to
 * d) is never one; at N = 45° a 45° chamfer is still fine and anything flatter is flagged.
 * **Bed contact is not an overhang**: a triangle whose corners all lie at the lowest level of
 * the model along `d` (the plate the model would sit on) has nothing under it to support.
 *
 * **The down direction can be a picked flat face** (P3-17): its outward normal is "down", the way
 * Place on Bed turns it, and the face's own plane is the bed (faces lying on it are bed contact,
 * whether or not it is the model's lowest level). The face is a persistent reference, so the
 * direction follows the model.
 *
 * The normal of a triangle is the mean of its three node normals (the kernel's exact surface
 * normals, so a cylinder's triangles differ from each other as the surface does), which is
 * also what the shader interpolates.
 */
import type { BodyId, GeomRef } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { sectionFrame } from '../section/clip';

export type Vec3 = readonly [number, number, number];

/** The directions "down" can be, in the order the panel lists them. */
export const DOWN_DIRECTIONS = [
  { id: '-z', label: '-Z (the bed)', vector: [0, 0, -1] },
  { id: '+z', label: '+Z', vector: [0, 0, 1] },
  { id: '-y', label: '-Y', vector: [0, -1, 0] },
  { id: '+y', label: '+Y', vector: [0, 1, 0] },
  { id: '-x', label: '-X', vector: [-1, 0, 0] },
  { id: '+x', label: '+X', vector: [1, 0, 0] },
] as const satisfies readonly { id: string; label: string; vector: Vec3 }[];

export type DownId = (typeof DOWN_DIRECTIONS)[number]['id'];

export const DEFAULT_DOWN: DownId = '-z';
export const DEFAULT_OVERHANG_ANGLE = '45 deg';

/** The overhang angle is 0…90°: 0 flags every downward face, 90 flags nothing. */
export const OVERHANG_RANGE = { min: 0, max: 90 } as const;

/** How far above the lowest level a triangle may lie and still be on the bed (mm). */
export const BED_TOLERANCE = 0.01;

/** Numeric slack of the threshold, so a face exactly at N° is not flagged. */
const SLACK = 1e-6;

/** The overhang analysis as the viewport stores it (view state, like the section). */
export interface OverhangState {
  /** An expression in degrees, 0…90 ("45 deg", "limit"). */
  angle: string;
  down: DownId;
  /**
   * A flat face that goes down (a persistent reference). While present it replaces `down`: the
   * direction is the face's outward normal and the bed is its plane.
   */
  face?: GeomRef;
  /** The view is shaded. */
  on: boolean;
}

/** What the view needs to shade: the direction, the threshold, the bed level. */
export interface OverhangView {
  /** Unit vector of "down". */
  down: Vec3;
  /** `sin N`: a normal with `n · down` above this is an overhang. */
  threshold: number;
  /** The lowest level of the model along `down` (max of `p · down`), mm. */
  bed: number;
}

export function downVector(id: DownId): Vec3 {
  return (DOWN_DIRECTIONS.find((d) => d.id === id) ?? DOWN_DIRECTIONS[0]).vector;
}

/**
 * The direction and bed level a picked face gives: its outward normal as "down" and its plane as
 * the bed. Undefined for a face the model no longer has.
 */
export function faceDown(
  face: GeomRef,
  bodies: Readonly<Record<string, BodyMesh>>,
): { down: Vec3; bed: number } | undefined {
  const frame = sectionFrame(face, { bodies });
  if (!frame) return undefined;
  const [x, y, z] = frame.normal;
  const length = Math.hypot(x, y, z);
  if (length === 0) return undefined;
  const down: Vec3 = [x / length, y / length, z / length];
  const o = frame.origin;
  return { down, bed: o[0] * down[0] + o[1] * down[1] + o[2] * down[2] };
}

/** The threshold for an angle in degrees. */
export function thresholdOf(degrees: number): number {
  return Math.sin((degrees * Math.PI) / 180) + SLACK;
}

const along = (p: Float32Array, node: number, d: Vec3) =>
  (p[3 * node] as number) * d[0] +
  (p[3 * node + 1] as number) * d[1] +
  (p[3 * node + 2] as number) * d[2];

/** The lowest level along `down` of all the meshes: the plate they would rest on. `NaN` with none. */
export function bedLevel(meshes: readonly BodyMesh[], down: Vec3): number {
  let level = Number.NEGATIVE_INFINITY;
  for (const mesh of meshes) {
    const count = mesh.positions.length / 3;
    for (let i = 0; i < count; i++) level = Math.max(level, along(mesh.positions, i, down));
  }
  return Number.isFinite(level) ? level : Number.NaN;
}

/** What one body's triangles come to. */
export interface BodyOverhang {
  /** Faces (mesh face indices) with at least one overhang triangle. */
  faces: number[];
  triangles: number;
  /** mm² of overhang triangles. */
  area: number;
  /** Triangles that lie on the bed (never counted as overhangs). */
  bed: number;
}

export interface OverhangReport {
  bodies: Record<string, BodyOverhang>;
  /** Faces with an overhang, over every body. */
  faces: number;
  triangles: number;
  area: number;
  bed: number;
}

/** Classifies one body's triangles (see the top of the file for the rule). */
export function analyzeBody(mesh: BodyMesh, view: OverhangView): BodyOverhang {
  const out: BodyOverhang = { faces: [], triangles: 0, area: 0, bed: 0 };
  const { positions: p, normals: n, indices, faceRanges } = mesh;
  const d = view.down;
  const faceCount = faceRanges.length >> 1;
  for (let f = 0; f < faceCount; f++) {
    const first = faceRanges[2 * f] as number;
    const count = faceRanges[2 * f + 1] as number;
    let flagged = false;
    for (let t = first; t < first + count; t++) {
      const a = indices[3 * t] as number;
      const b = indices[3 * t + 1] as number;
      const c = indices[3 * t + 2] as number;
      // On the bed: all three corners at the lowest level.
      const floor = view.bed - BED_TOLERANCE;
      if (along(p, a, d) >= floor && along(p, b, d) >= floor && along(p, c, d) >= floor) {
        out.bed++;
        continue;
      }
      const nx = (n[3 * a] as number) + (n[3 * b] as number) + (n[3 * c] as number);
      const ny = (n[3 * a + 1] as number) + (n[3 * b + 1] as number) + (n[3 * c + 1] as number);
      const nz = (n[3 * a + 2] as number) + (n[3 * b + 2] as number) + (n[3 * c + 2] as number);
      const length = Math.hypot(nx, ny, nz);
      if (length === 0) continue;
      if ((nx * d[0] + ny * d[1] + nz * d[2]) / length <= view.threshold) continue;
      flagged = true;
      out.triangles++;
      out.area += triangleArea(p, a, b, c);
    }
    if (flagged) out.faces.push(f);
  }
  return out;
}

function triangleArea(p: Float32Array, a: number, b: number, c: number): number {
  const ux = (p[3 * b] as number) - (p[3 * a] as number);
  const uy = (p[3 * b + 1] as number) - (p[3 * a + 1] as number);
  const uz = (p[3 * b + 2] as number) - (p[3 * a + 2] as number);
  const vx = (p[3 * c] as number) - (p[3 * a] as number);
  const vy = (p[3 * c + 1] as number) - (p[3 * a + 1] as number);
  const vz = (p[3 * c + 2] as number) - (p[3 * a + 2] as number);
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/** Classifies every body of `meshes` against one view (one bed for all of them). */
export function analyzeOverhang(
  meshes: readonly { id: BodyId; mesh: BodyMesh }[],
  view: OverhangView,
): OverhangReport {
  const report: OverhangReport = { bodies: {}, faces: 0, triangles: 0, area: 0, bed: 0 };
  for (const { id, mesh } of meshes) {
    const body = analyzeBody(mesh, view);
    report.bodies[id] = body;
    report.faces += body.faces.length;
    report.triangles += body.triangles;
    report.area += body.area;
    report.bed += body.bed;
  }
  return report;
}

/**
 * The analysis for tests (`data-overhang` on the Viewport region):
 * "down=-z angle=45 faces=3 triangles=14 area=812.5 bed=2", the angle as typed by the
 * expression's value.
 */
export function overhangSummary(
  state: OverhangState,
  degrees: number | undefined,
  report: OverhangReport | undefined,
  /** The picked face's direction, when the state has one and the model still has it. */
  faceVector?: Vec3,
): string {
  const down = state.face
    ? `face(${faceVector ? faceVector.map((x) => round(x)).join(',') : '?'})`
    : state.down;
  const base = `down=${down} angle=${degrees === undefined ? '?' : round(degrees)}`;
  if (!report) return `${base} off`;
  return `${base} faces=${report.faces} triangles=${report.triangles} area=${round(report.area)} bed=${report.bed}`;
}

const round = (x: number) => `${Math.round(x * 10) / 10 + 0}`;
