/**
 * Planar curves and the faces between them (P2-02, ADR-0025): what the
 * kernel makes of a sketch. Curves are in the plane's own 2D frame, in mm;
 * the faces come back placed in the plane.
 */
import type { ShapeHandle, Vec3 } from './kernel';

export type Vec2 = readonly [number, number];

/**
 * A curve in a plane. Directions follow the sketch model: a line runs from
 * `a` to `b`, arcs and ellipses counter-clockwise, a spline along its
 * parameter.
 */
export type PlanarCurve =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  /** From angle `from` (radians) counter-clockwise through `sweep`; a full circle when sweep ≥ 2π. */
  | { kind: 'arc'; center: Vec2; radius: number; from: number; sweep: number }
  /** A full ellipse; `rotation` is the direction of the `a` axis (radians). */
  | { kind: 'ellipse'; center: Vec2; a: number; b: number; rotation: number }
  /** A clamped, non-rational B-spline; `knots` is the full vector (poles + degree + 1). */
  | { kind: 'spline'; degree: number; poles: readonly Vec2[]; knots: readonly number[] }
  /**
   * A sketch conic exactly (P4-12, ADR-0063's amendment): the rational
   * quadratic Bézier from `start` to `end` whose end tangents point at
   * `shoulder`, middle weight `rho / (1 − rho)`; 0 < rho < 1.
   */
  | { kind: 'conic'; start: Vec2; shoulder: Vec2; end: Vec2; rho: number };

/** Where a plane sits in the world: its origin, X direction and normal (Y = normal × X). */
export interface PlanarFrame {
  origin: Vec3;
  x: Vec3;
  normal: Vec3;
}

/** One curve's share of a face's outer loop. */
export interface PlanarLoopEdge {
  /** Index into the curve list. */
  curve: number;
  /** Runs against the curve's own direction. */
  reversed: boolean;
}

export interface PlanarFace {
  shape: ShapeHandle;
  /** The curves around the outer loop (counter-clockwise), in no particular order. */
  outer: PlanarLoopEdge[];
  /** The curve each of the face's edges comes from, in sub-shape order (-1 if unknown). */
  edges: number[];
  holes: number;
  /** mm². */
  area: number;
  /** Area centroid in the plane's 2D frame. */
  centroid: Vec2;
}

export interface PlanarFacesResult {
  faces: PlanarFace[];
  /** Curves the kernel couldn't build (no length, say), by index. */
  skipped: number[];
}

/** Decodes the facade's profile records (see sketchProfiles in the facade). */
export function decodePlanarFaces(
  records: Int32Array,
  numbers: Float64Array,
  curveIndex: readonly number[],
): PlanarFace[] {
  const faces: PlanarFace[] = [];
  let i = 0;
  let k = 0;
  const next = () => records[i++] as number;
  const curve = (index: number) => (index < 0 ? -1 : (curveIndex[index] ?? -1));
  while (i < records.length) {
    const shape = next() as ShapeHandle;
    const holes = next();
    const outer: PlanarLoopEdge[] = [];
    for (let n = next(); n > 0; n--) {
      const index = next();
      outer.push({ curve: curve(index), reversed: next() === 1 });
    }
    const edges: number[] = [];
    for (let m = next(); m > 0; m--) edges.push(curve(next()));
    faces.push({
      shape,
      outer,
      edges,
      holes,
      area: numbers[3 * k] as number,
      centroid: [numbers[3 * k + 1] as number, numbers[3 * k + 2] as number],
    });
    k++;
  }
  return faces;
}
