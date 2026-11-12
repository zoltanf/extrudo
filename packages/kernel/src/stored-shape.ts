/**
 * A third-party file's stored shape as STEP (P6-25 S3, ADR-0144 decision 5):
 * read the B-rep text, place it, write STEP with our own writer and read that
 * STEP back, all in one call, so the caller can compare what it will import
 * with what the file stored. Only an import's throwaway kernel runs it
 * (`KernelServiceOptions.importKernel`).
 */
import { compose, IDENTITY, type Matrix12 } from './features/matrix';
import { type Kernel, KernelError, type ShapeHandle, type Vec3 } from './kernel';
import type { CurveType, ShapeDescription, SurfaceType } from './naming/description';

/** A rigid placement: a move, then a turn by a unit quaternion `[x, y, z, w]` (FreeCAD's form). */
export interface ShapePlacement {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
}

/** What a shape measures: the volume of its solids, its faces' area, a tight box, its centre of mass. */
export interface StoredShapeMeasure {
  solids: number;
  volume: number;
  area: number;
  box: { min: [number, number, number]; max: [number, number, number] };
  /**
   * The centre of mass of its solids (of its faces when it has none; the
   * origin when it has neither), mm (ADR-0144 S6: what tells a chamfer from
   * its flipped twin, which has the same volume, area and box).
   */
  centre: [number, number, number];
}

export interface StoredShapeStep extends StoredShapeMeasure {
  /** The STEP text our writer made of the placed shape. */
  step: string;
  /** The placed shape as read from the B-rep text, before STEP. */
  read: StoredShapeMeasure;
}

export interface StoredShapeOptions {
  /** The STEP product's name. */
  name?: string;
  /** `#rrggbb`, written as the solids' colour. */
  color?: string;
}

/** The 3 × 4 matrix of one placement: `x ↦ R·x + t`. */
export function placementMatrix(p: ShapePlacement): Matrix12 {
  const values = [...p.position, ...p.rotation];
  if (!values.every(Number.isFinite))
    throw new KernelError('A placement has a number that is not finite.');
  const [px, py, pz] = p.position;
  let [x, y, z, w] = p.rotation;
  const n = Math.hypot(x, y, z, w);
  if (n === 0) throw new KernelError('A placement has a zero rotation.');
  [x, y, z, w] = [x / n, y / n, z / n, w / n];
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    px,
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    py,
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
    pz,
  ] as unknown as Matrix12;
}

/** The placements composed, outermost first: `P0 · P1 · … · Pn`. */
export function chainMatrix(chain: readonly ShapePlacement[]): Matrix12 {
  return chain.reduce<Matrix12>((m, p) => compose(m, placementMatrix(p)), IDENTITY);
}

const isIdentity = (m: Matrix12) =>
  m.every((v, i) => Math.abs(v - (IDENTITY[i] as number)) < 1e-15);

/**
 * What a shape measures: its solids (counted, then released), the volume of
 * those solids, its faces' area, its tight box and its centre of mass
 * (`Kernel.properties`). The
 * one definition both sides of an import's checks use (ADR-0144): a stored
 * shape and a rebuilt body are measured by this code only.
 */
export function measureShape(kernel: Kernel, shape: ShapeHandle): StoredShapeMeasure {
  const solids = kernel.solids(shape);
  // One by one: a spread of a huge count overflows the stack and leaks the handles.
  for (const solid of solids) kernel.release(solid);
  const { volume, area, bbox, centroid } = kernel.properties(shape);
  // A shape of no mass has no centre: the origin stands in, the same on both sides.
  const centre: [number, number, number] = centroid.every(Number.isFinite)
    ? [...centroid]
    : [0, 0, 0];
  return {
    solids: solids.length,
    volume,
    area,
    box: { min: [...bbox.min], max: [...bbox.max] },
    centre,
  };
}

/**
 * The header's time stamp set to a fixed one, so the same shape always gives
 * the same bytes and two copies of it share one attachment (named by SHA-256,
 * ADR-0066). Only the header's `FILE_NAME` changes.
 */
function fixedStamp(step: string): string {
  return step.replace(/^(FILE_NAME\('(?:[^']|'')*',)'[^']*'/m, "$1'2000-01-01T00:00:00'");
}

/**
 * Reads `text` (`Kernel.readBrep`'s checks), places it by `chain`, writes it
 * as STEP and reads that back. Every shape is released before it returns or
 * throws. A shape without a solid comes back with no STEP (`step: ''`, `solids: 0`).
 */
export function storedShapeToStep(
  kernel: Kernel,
  text: string,
  chain: readonly ShapePlacement[],
  options: StoredShapeOptions = {},
): StoredShapeStep {
  using scope = kernel.scope();
  const matrix = chainMatrix(chain);
  const read = scope.track(kernel.readBrep(text));
  const placed = isIdentity(matrix) ? read : scope.track(kernel.transform(read, matrix).shape);
  const before = measureShape(kernel, placed);
  // Nothing to import: no STEP, and the caller says so (not a failure).
  if (before.solids === 0) return { step: '', ...before, read: before };
  const step = kernel.writeStep([
    {
      shape: placed,
      name: options.name ?? 'Shape',
      ...(options.color !== undefined && { color: options.color }),
    },
  ]);
  const back = scope.track(kernel.readStep(step));
  return { step: fixedStamp(step), ...measureShape(kernel, back), read: before };
}

/**
 * Reads `text` (`Kernel.readBrep`'s checks), places it by `chain` and
 * measures it (`measureShape`), with no STEP: the shape a file stores for a
 * feature, to compare with the body Extrudo rebuilt for it (ADR-0144 S5).
 * Every shape is released before it returns or throws.
 */
export function measureStoredShape(
  kernel: Kernel,
  text: string,
  chain: readonly ShapePlacement[],
): StoredShapeMeasure {
  using scope = kernel.scope();
  const matrix = chainMatrix(chain);
  const read = scope.track(kernel.readBrep(text));
  const placed = isIdentity(matrix) ? read : scope.track(kernel.transform(read, matrix).shape);
  return measureShape(kernel, placed);
}

/** An edge of a shape described for an import's matching (ADR-0144 S6), in world mm. */
export interface ElementEdge {
  /** Its 0-based place among the shape's edges (`TopExp::MapShapes` order). */
  index: number;
  type: CurveType;
  /** mm; 0 for a degenerate edge. */
  length: number;
  /** The point in the middle of its parameter range. */
  midpoint: Vec3;
  /** A line's direction, a circle's or ellipse's axis, else the middle tangent (canonical sign). */
  direction?: Vec3;
  /**
   * Its two ends (one point twice for a closed edge; none for a degenerate
   * edge), only where the edge is described in detail (`describeElements`).
   */
  ends?: Vec3[];
  /** A circle's or ellipse's centre and (major) radius, in detail only. */
  centre?: Vec3;
  radius?: number;
  /** The distinct faces it bounds, by index. */
  faces: number[];
}

/** A face of a shape described for an import's matching (ADR-0144 S6). */
export interface ElementFace {
  index: number;
  type: SurfaceType;
  /** mm². */
  area: number;
  centroid: Vec3;
  /** A plane's outward normal, an axis (canonical sign), else the middle normal; none for a sphere. */
  direction?: Vec3;
  /** Its edges, by index. */
  edges: number[];
}

/** What a shape's description for matching holds: its counts and the elements described. */
export interface ShapeElements {
  edgeCount: number;
  faceCount: number;
  edges: ElementEdge[];
  faces: ElementFace[];
  /**
   * Set, with nothing described, when the request would describe more than
   * `MAX_DESCRIBED_EDGES` edges: how many. An answer, not an error, so a
   * large body costs the import no kernel restart.
   */
  over?: number;
}

/**
 * The most edges one description may describe (ADR-0144's S6 amendment: the
 * library's largest body a dress-up describes has 90); past it nothing is
 * described, so what crosses from the kernel stays bounded.
 */
export const MAX_DESCRIBED_EDGES = 20_000;
/**
 * The most edges described in detail (ends, circle): `Kernel.edgeGeometry`
 * maps the shape's edges again on every call, so detail costs each such edge
 * the whole shape. 2,000 of 20,000 edges is a few seconds.
 */
export const MAX_DETAILED_EDGES = 2_000;

/** Where detail is wanted on a whole shape: the edges whose midpoints lie within `radius` of a point. */
export interface DetailNear {
  points: readonly Vec3[];
  /** mm. */
  radius: number;
}

/** Which elements to describe: all of them, or the edges and faces asked for and their neighbours. */
export interface ElementRequest {
  /** 0-based edge indices; each with the faces it bounds. */
  edges: readonly number[];
  /** 0-based face indices; each with its edges. */
  faces: readonly number[];
}

/**
 * Describes edges and faces of `shape` (`Kernel.describe`, linear in the
 * shape): with `ask`, the edges and faces asked for, the faces each asked
 * edge bounds and the edges of each asked face, every edge in detail (its
 * ends and circle, `Kernel.edgeGeometry`); without, every edge and face, in
 * detail only the edges whose midpoints are `near` a point. Indices out of
 * range are left out (the counts say why). Past `MAX_DESCRIBED_EDGES` edges,
 * or `MAX_DETAILED_EDGES` in detail, it describes none and says so (`over`).
 */
export function describeElements(
  kernel: Kernel,
  shape: ShapeHandle,
  ask?: ElementRequest,
  near?: DetailNear,
): ShapeElements {
  const d = kernel.describe(shape);
  const edgeCount = d.edges.length;
  const faceCount = d.faces.length;
  const faceEdges: number[][] = d.faces.map(() => []);
  d.edges.forEach((e, i) => {
    for (const f of e.faces) faceEdges[f]?.push(i);
  });
  let edgeSet: Set<number>;
  let faceSet: Set<number>;
  if (ask) {
    const inRange = (n: number, count: number) => Number.isInteger(n) && n >= 0 && n < count;
    edgeSet = new Set(ask.edges.filter((n) => inRange(n, edgeCount)));
    faceSet = new Set(ask.faces.filter((n) => inRange(n, faceCount)));
    for (const e of [...edgeSet]) for (const f of d.edges[e]?.faces ?? []) faceSet.add(f);
    for (const f of ask.faces)
      if (inRange(f, faceCount)) for (const e of faceEdges[f] ?? []) edgeSet.add(e);
  } else {
    edgeSet = new Set(d.edges.keys());
    faceSet = new Set(d.faces.keys());
  }
  if (edgeSet.size > MAX_DESCRIBED_EDGES)
    return { edgeCount, faceCount, edges: [], faces: [], over: edgeSet.size };
  const detailed = ask ? edgeSet : nearEdges(d, near);
  if (detailed.size > MAX_DETAILED_EDGES)
    return { edgeCount, faceCount, edges: [], faces: [], over: detailed.size };
  const edges: ElementEdge[] = [];
  for (const index of [...edgeSet].sort((a, b) => a - b)) {
    const e = d.edges[index] as ShapeDescription['edges'][number];
    const out: ElementEdge = {
      index,
      type: e.type,
      length: e.length,
      midpoint: e.midpoint,
      faces: [...e.faces],
    };
    if (e.direction) out.direction = e.direction;
    if (detailed.has(index)) out.ends = [];
    if (detailed.has(index) && e.type !== 'degenerate') {
      const g = kernel.edgeGeometry(shape, index, 2);
      if (g.type !== 'degenerate') {
        const first = g.points[0];
        const last = g.points.at(-1);
        if (first && last) out.ends = [first, last];
        if (g.conic) {
          out.centre = g.conic.center;
          out.radius = g.conic.radius;
        }
      }
    }
    edges.push(out);
  }
  const faces: ElementFace[] = [...faceSet]
    .sort((a, b) => a - b)
    .map((index) => {
      const f = d.faces[index] as ShapeDescription['faces'][number];
      const out: ElementFace = {
        index,
        type: f.type,
        area: f.area,
        centroid: f.centroid,
        edges: faceEdges[index] ?? [],
      };
      if (f.direction) out.direction = f.direction;
      return out;
    });
  return { edgeCount, faceCount, edges, faces };
}

/** The edges whose midpoints lie within `near.radius` of one of its points, through a grid of that cell. */
function nearEdges(d: ShapeDescription, near: DetailNear | undefined): Set<number> {
  const out = new Set<number>();
  if (!near || near.points.length === 0) return out;
  const r = near.radius;
  if (!(r > 0 && Number.isFinite(r)))
    throw new KernelError('The detail radius is not a positive number.');
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const cells = new Map<string, Vec3[]>();
  for (const p of near.points) {
    if (!p.every(Number.isFinite)) throw new KernelError('A detail point is not finite.');
    const k = key(Math.floor(p[0] / r), Math.floor(p[1] / r), Math.floor(p[2] / r));
    const list = cells.get(k);
    if (list) list.push(p);
    else cells.set(k, [p]);
  }
  d.edges.forEach((e, i) => {
    const [x, y, z] = e.midpoint.map((v) => Math.floor(v / r)) as [number, number, number];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const p of cells.get(key(x + dx, y + dy, z + dz)) ?? [])
            if (Math.hypot(p[0] - e.midpoint[0], p[1] - e.midpoint[1], p[2] - e.midpoint[2]) <= r)
              out.add(i);
  });
  return out;
}

/**
 * Reads `text` (`Kernel.readBrep`'s checks), places it by `chain` and
 * describes the edges and faces `ask` names (`describeElements`): the
 * elements a FreeCAD dress-up names on the shape its base stores, to look up
 * on the rebuilt body (ADR-0144 decision 4, S6). Every shape is released
 * before it returns or throws.
 */
export function describeStoredShape(
  kernel: Kernel,
  text: string,
  chain: readonly ShapePlacement[],
  ask: ElementRequest,
): ShapeElements {
  using scope = kernel.scope();
  const matrix = chainMatrix(chain);
  const read = scope.track(kernel.readBrep(text));
  const placed = isIdentity(matrix) ? read : scope.track(kernel.transform(read, matrix).shape);
  return describeElements(kernel, placed, ask);
}
