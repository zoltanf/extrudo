/**
 * Geometry and adjacency of a shape's faces, edges and vertices, in the
 * kernel's sub-shape order (the facade's `describe`). Topological naming
 * orders split pieces by it and makes fingerprints of it (ADR-0005).
 */
import type { Vec3 } from '../kernel';

export type SurfaceType =
  | 'plane'
  | 'cylinder'
  | 'cone'
  | 'sphere'
  | 'torus'
  | 'bezier'
  | 'bspline'
  | 'revolution'
  | 'extrusion'
  | 'offset'
  | 'other';

export type CurveType =
  | 'line'
  | 'circle'
  | 'ellipse'
  | 'hyperbola'
  | 'parabola'
  | 'bezier'
  | 'bspline'
  | 'offset'
  | 'other'
  | 'degenerate';

/** In the facade's numeric order (GeomAbs_SurfaceType). */
const SURFACE_TYPES: readonly SurfaceType[] = [
  'plane',
  'cylinder',
  'cone',
  'sphere',
  'torus',
  'bezier',
  'bspline',
  'revolution',
  'extrusion',
  'offset',
  'other',
];

/** In the facade's numeric order (GeomAbs_CurveType); -1 is a degenerate edge. */
const CURVE_TYPES: readonly CurveType[] = [
  'line',
  'circle',
  'ellipse',
  'hyperbola',
  'parabola',
  'bezier',
  'bspline',
  'offset',
  'other',
];

export interface FaceInfo {
  type: SurfaceType;
  /** mm². */
  area: number;
  centroid: Vec3;
  /**
   * The outward normal of a plane (other surfaces without an axis: the
   * normal in the middle of the parameter range), the axis of a cylinder,
   * cone, torus or surface of revolution (canonical sign: first non-zero
   * component positive). Absent for a sphere.
   */
  direction?: Vec3;
}

export interface EdgeInfo {
  type: CurveType;
  /** mm; 0 for a degenerate edge. */
  length: number;
  /** The point in the middle of its parameter range. */
  midpoint: Vec3;
  /** A line's direction, a circle's or ellipse's axis, else the middle tangent (canonical sign). */
  direction?: Vec3;
  /** The distinct faces the edge bounds, as face indices. */
  faces: number[];
}

export interface VertexInfo {
  point: Vec3;
  /** The distinct faces around the vertex, as face indices. */
  faces: number[];
}

export interface ShapeDescription {
  faces: FaceInfo[];
  edges: EdgeInfo[];
  vertices: VertexInfo[];
}

/** Decodes the facade's `describeInts` / `describeNumbers` (see `describe` in the facade). */
export function decodeDescription(ints: Int32Array, numbers: Float64Array): ShapeDescription {
  let i = 0;
  let k = 0;
  const int = () => {
    const value = ints[i++];
    if (value === undefined) throw new Error('Truncated shape description');
    return value;
  };
  const num = () => numbers[k++] as number;
  const vec = (): Vec3 => [num(), num(), num()];
  const direction = (): Vec3 | undefined => {
    const d = vec();
    return d[0] === 0 && d[1] === 0 && d[2] === 0 ? undefined : d;
  };
  const adjacent = () => {
    const faces: number[] = [];
    for (let n = int(); n > 0; n--) faces.push(int());
    return faces;
  };

  const faceCount = int();
  const edgeCount = int();
  const vertexCount = int();
  const faces: FaceInfo[] = [];
  for (let f = 0; f < faceCount; f++) {
    const type = SURFACE_TYPES[int()] ?? 'other';
    const area = num();
    const centroid = vec();
    const d = direction();
    faces.push(d ? { type, area, centroid, direction: d } : { type, area, centroid });
  }
  const edges: EdgeInfo[] = [];
  for (let e = 0; e < edgeCount; e++) {
    const code = int();
    const type: CurveType = code < 0 ? 'degenerate' : (CURVE_TYPES[code] ?? 'other');
    const length = num();
    const midpoint = vec();
    const d = direction();
    const around = adjacent();
    edges.push(
      d
        ? { type, length, midpoint, direction: d, faces: around }
        : { type, length, midpoint, faces: around },
    );
  }
  const vertices: VertexInfo[] = [];
  for (let v = 0; v < vertexCount; v++) {
    const point = vec();
    vertices.push({ point, faces: adjacent() });
  }
  return { faces, edges, vertices };
}
