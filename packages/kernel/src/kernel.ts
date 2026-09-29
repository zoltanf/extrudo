import { decodeHistory, type HistoryRecord, type SubShapeKind } from './history';
import type { BodyMesh, ExportMesh, Measurements, MeshOptions } from './mesh';
import { decodeDescription, type ShapeDescription } from './naming/description';
import type { FacadeBinding, OcctModule } from './occt/types';
import {
  decodePlanarFaces,
  type PlanarCurve,
  type PlanarFacesResult,
  type PlanarFrame,
} from './planar';

/** A shape held in the facade's arena. Release it (or use a ShapeScope) when done. */
export type ShapeHandle = number & { readonly __brand: 'ShapeHandle' };

export type Vec3 = readonly [number, number, number];

/** A kernel operation failed in a way the user can act on (bad radius, …). */
export class KernelError extends Error {
  override name = 'KernelError';
}

/**
 * Why a fillet failed, for messages a person can act on (P3-01, ADR-0038):
 * the facade's diagnosis of the failed fillet. Edge indices are the shape's.
 */
export type FilletProblem =
  /** The radius is too large for a chain of tangent edges; `max` is the largest that works (0: none). */
  | { kind: 'too-large'; edges: number[]; max: number }
  /** OCCT can't fillet this edge (it isn't between two faces). */
  | { kind: 'unfilletable'; edges: number[] }
  /** Edges of one tangent chain were given different radii. */
  | { kind: 'mixed-radii'; edges: number[] }
  /** Each chain works alone, not all together; `factor` is the largest scale of all radii that works. */
  | { kind: 'together'; edges: number[]; factor: number }
  | { kind: 'other' };

/** A fillet OCCT couldn't build, with its diagnosis. */
export class FilletError extends KernelError {
  override name = 'FilletError';
  constructor(
    message: string,
    readonly problems: readonly FilletProblem[],
  ) {
    super(message);
  }
}

/**
 * Why a chamfer failed (P3-02, ADR-0043): the facade's diagnosis, in the same
 * shapes as a fillet's. Edge indices are the shape's.
 */
export type ChamferProblem =
  /**
   * The distances are too large for a chain of tangent edges; `factor` is the
   * largest scale (0..1) of its distances that works (0: none does).
   */
  | { kind: 'too-large'; edges: number[]; factor: number }
  /** OCCT can't chamfer this edge (it isn't between two faces). */
  | { kind: 'unchamferable'; edges: number[] }
  /** Edges of one tangent chain were given different settings. */
  | { kind: 'mixed'; edges: number[] }
  /** Each chain works alone, not all together; `factor` is the largest scale of all distances that works. */
  | { kind: 'together'; edges: number[]; factor: number }
  | { kind: 'other' };

/** A chamfer OCCT couldn't build, with its diagnosis. */
export class ChamferError extends KernelError {
  override name = 'ChamferError';
  constructor(
    message: string,
    readonly problems: readonly ChamferProblem[],
  ) {
    super(message);
  }
}

/** One edge's chamfer: how it is sized (P3-02). */
export type ChamferSpec =
  /** `distance` from the edge on both faces. */
  | { mode: 'equal'; distance: number }
  /**
   * `distance` on the reference face (the lower-numbered of the two around
   * the edge, the other with `flip`), `distanceB` on the other.
   */
  | { mode: 'two-distances'; distance: number; distanceB: number; flip?: boolean }
  /** `distance` on the reference face, the chamfer at `angle` (radians) to it. */
  | { mode: 'distance-angle'; distance: number; angle: number; flip?: boolean };

export interface OperationResult {
  shape: ShapeHandle;
  history: HistoryRecord[];
}

export interface BooleanOptions {
  /**
   * Merge faces and edges that lie on one surface or curve afterwards
   * (a join flush with a side leaves one face, not two). The history
   * accounts for it: a merged face is `modified` from each of its pieces.
   */
  simplify?: boolean;
}

/** An axis in space, for revolve. */
export interface Axis {
  origin: Vec3;
  direction: Vec3;
}

export interface KernelStats {
  /** Shapes held in the arena. */
  liveShapes: number;
  /** Top of the malloc heap in bytes (grows only; see heapTop() in the facade). */
  heapTop: number;
  /** Size of the WASM memory in bytes. */
  heapBytes: number;
}

const KIND_CODE: Record<SubShapeKind, number> = { face: 0, edge: 1, vertex: 2 };
const BOOLEAN_CODE = { fuse: 0, cut: 1, common: 2 } as const;
/** The facade's sub-shape kind code for solids (count, subShape). */
const SOLID_CODE = 3;

type TypedArrayConstructor<T> = new (buffer: ArrayBuffer, byteOffset: number, length: number) => T;

/**
 * The kernel's TypeScript layer over the C++ facade (ADR-0001). Every method
 * runs synchronously in the calling thread: the worker in the app, the test
 * process in Node. Shapes are integer handles; nothing here holds an OCCT
 * object, so nothing here can leak one.
 */
export class Kernel {
  readonly #oc: OcctModule;
  readonly #facade: FacadeBinding;

  constructor(oc: OcctModule) {
    this.#oc = oc;
    this.#facade = new oc.ExtrudoFacade();
  }

  box(size: Vec3, origin: Vec3 = [0, 0, 0]): ShapeHandle {
    return this.#check(this.#facade.makeBox(...origin, ...size));
  }

  cylinder(radius: number, height: number, origin: Vec3 = [0, 0, 0], axis: Vec3 = [0, 0, 1]) {
    return this.#check(this.#facade.makeCylinder(...origin, ...axis, radius, height));
  }

  /**
   * Fillets edges (indices into the shape's edge list) with `radius`: one
   * value for all, or one per edge. OCCT rounds a whole chain of
   * tangent-continuous edges once one of them is given, so edges of one
   * chain must share a radius. A failure is a `FilletError` with the
   * facade's diagnosis (which chains, and the largest radius that works).
   * History: input 0; a filleted edge is deleted and generates its face.
   */
  fillet(
    shape: ShapeHandle,
    edges: readonly number[],
    radius: number | readonly number[],
  ): OperationResult {
    const f = this.#facade;
    f.clearArgs();
    f.clearNumbers();
    edges.forEach((edge, i) => {
      f.pushArg(edge);
      f.pushNumber(typeof radius === 'number' ? radius : (radius[i] as number));
    });
    const handle = f.fillet(shape);
    if (handle === 0) {
      throw new FilletError(
        f.lastError() || 'The fillet failed.',
        decodeFilletProblems(this.#copy(Float64Array, f.geometryPtr(), f.geometrySize())),
      );
    }
    return this.#withHistory(handle);
  }

  /**
   * The edges (indices) of the tangent-continuous chain around `edge`, the
   * edge included: what `fillet` rounds together.
   */
  tangentChain(shape: ShapeHandle, edge: number): number[] {
    const f = this.#facade;
    if (f.tangentChain(shape, edge) < 0) throw new KernelError(f.lastError() || 'Unknown edge.');
    return Array.from(this.#copy(Int32Array, f.lookupPtr(), f.lookupSize()));
  }

  /**
   * Chamfers edges (indices into the shape's edge list), each with its own
   * `ChamferSpec` (or one for all). As in a fillet, OCCT chamfers a whole
   * chain of tangent-continuous edges once one of them is given, so edges of
   * one chain must share their spec, and the first of them listed picks the
   * chain's reference face. A failure is a `ChamferError` with the facade's
   * diagnosis. History: input 0; a chamfered edge is deleted and generates
   * its face.
   */
  chamfer(
    shape: ShapeHandle,
    edges: readonly number[],
    spec: ChamferSpec | readonly ChamferSpec[],
  ): OperationResult {
    const f = this.#facade;
    f.clearArgs();
    f.clearNumbers();
    edges.forEach((edge, i) => {
      const one = 'mode' in spec ? spec : (spec[i] as ChamferSpec);
      f.pushArg(edge);
      f.pushNumber(one.mode === 'equal' ? 0 : one.mode === 'two-distances' ? 1 : 2);
      f.pushNumber(one.distance);
      f.pushNumber(
        one.mode === 'equal' ? 0 : one.mode === 'two-distances' ? one.distanceB : one.angle,
      );
      f.pushNumber(one.mode !== 'equal' && one.flip ? 1 : 0);
    });
    const handle = f.chamfer(shape);
    if (handle === 0) {
      throw new ChamferError(
        f.lastError() || 'The chamfer failed.',
        decodeChamferProblems(this.#copy(Float64Array, f.geometryPtr(), f.geometrySize())),
      );
    }
    return this.#withHistory(handle);
  }

  /** `target` minus `tool`. History: input 0 is the target, 1 the tool. */
  cut(target: ShapeHandle, tool: ShapeHandle, options: BooleanOptions = {}): OperationResult {
    return this.boolean('cut', target, tool, options);
  }

  fuse(target: ShapeHandle, tool: ShapeHandle, options: BooleanOptions = {}): OperationResult {
    return this.boolean('fuse', target, tool, options);
  }

  common(target: ShapeHandle, tool: ShapeHandle, options: BooleanOptions = {}): OperationResult {
    return this.boolean('common', target, tool, options);
  }

  boolean(
    op: keyof typeof BOOLEAN_CODE,
    target: ShapeHandle,
    tool: ShapeHandle,
    options: BooleanOptions = {},
  ): OperationResult {
    const code = BOOLEAN_CODE[op];
    return this.#withHistory(this.#facade.boolean(code, target, tool, options.simplify ?? false));
  }

  /**
   * Moves, turns or mirrors a shape by a 3 × 4 matrix (the rows of its
   * rotation or reflection, each followed by its translation: see
   * `features/matrix.ts`). A scale fails. The result is a rebuilt shape, not
   * a located one, with the input's sub-shape order. History (input 0):
   * every face, edge and vertex is `modified` into its image.
   */
  transform(shape: ShapeHandle, matrix: readonly number[]): OperationResult {
    if (matrix.length !== 12) throw new KernelError('A transform needs 12 numbers.');
    const f = this.#facade;
    f.clearNumbers();
    for (const value of matrix) f.pushNumber(value);
    return this.#withHistory(f.transform(shape));
  }

  /**
   * Sweeps a shape (a face, a compound of faces) along `vector`, after
   * moving it by `shift`: an extrude that starts off its plane (symmetric,
   * two sides) sweeps the shifted profile. History (input 0, indices of the
   * shape as passed in): `generated` (edge → side face, vertex → side
   * edge), `first` and `last` (the copies at the start and end).
   *
   * `taper` (radians, |taper| < π/2) tilts the side faces about their edges
   * in the start plane: positive widens the outline along the sweep,
   * negative narrows it (holes the other way). Only sides from lines,
   * arcs and circles can be tapered; a taper that makes the sides meet
   * fails. The history is the same as without a taper.
   */
  prism(shape: ShapeHandle, vector: Vec3, shift: Vec3 = [0, 0, 0], taper = 0): OperationResult {
    return this.#withHistory(this.#facade.prism(shape, ...shift, ...vector, taper));
  }

  /**
   * The smallest distance between two shapes in mm: 0 where they touch,
   * overlap or one lies inside a solid of the other.
   */
  distance(a: ShapeHandle, b: ShapeHandle): number {
    const d = this.#facade.distance(a, b);
    if (d < 0) throw new KernelError(this.#facade.lastError() || 'Unknown shape.');
    return d;
  }

  /**
   * `distance`, with the closest points: `from` on `a`, `to` on `b` (the
   * same point of the inner shape where one is inside the other).
   */
  closestPoints(a: ShapeHandle, b: ShapeHandle): { distance: number; from: Vec3; to: Vec3 } {
    const distance = this.distance(a, b);
    const f = this.#facade;
    const v = this.#copy(Float64Array, f.geometryPtr(), f.geometrySize());
    if (v.length < 6) throw new KernelError("Couldn't find the closest points of these shapes.");
    const at = (k: number) => v[k] as number;
    return { distance, from: [at(0), at(1), at(2)], to: [at(3), at(4), at(5)] };
  }

  /** New handles to each solid of a shape (a compound of solids from a boolean or a sweep). */
  solids(shape: ShapeHandle): ShapeHandle[] {
    const n = this.#facade.count(shape, SOLID_CODE);
    if (n < 0) throw new KernelError('Unknown shape.');
    const out: ShapeHandle[] = [];
    try {
      for (let i = 0; i < n; i++)
        out.push(this.#check(this.#facade.subShape(shape, SOLID_CODE, i)));
    } catch (error) {
      this.release(...out);
      throw error;
    }
    return out;
  }

  /**
   * Revolves a shape about `axis` by `angle` radians, counter-clockwise
   * seen from the axis's tip; |angle| ≥ 2π is a full revolution, which has
   * no start and end faces. History as for `prism`.
   */
  revolve(shape: ShapeHandle, axis: Axis, angle: number): OperationResult {
    const { origin: o, direction: d } = axis;
    return this.#withHistory(this.#facade.revolve(shape, ...o, ...d, angle));
  }

  /** A compound holding the shapes (which stay valid; release them separately). */
  compound(shapes: readonly ShapeHandle[]): ShapeHandle {
    this.#facade.clearArgs();
    for (const shape of shapes) this.#facade.pushArg(shape);
    return this.#check(this.#facade.compound());
  }

  /** A new handle to one face, edge or vertex of a shape (by sub-shape index). */
  subShape(shape: ShapeHandle, kind: SubShapeKind, index: number): ShapeHandle {
    return this.#check(this.#facade.subShape(shape, KIND_CODE[kind], index));
  }

  /**
   * Where the sub-shapes of one kind of `part` sit in `whole`: for each, in
   * part's order, its index in whole, or -1 where it isn't part of whole.
   * (A face of a body: which body edges bound it.)
   */
  locate(part: ShapeHandle, whole: ShapeHandle, kind: SubShapeKind): number[] {
    const f = this.#facade;
    if (f.locate(part, whole, KIND_CODE[kind]) < 0) throw new KernelError('Unknown shape.');
    return Array.from(this.#copy(Int32Array, f.lookupPtr(), f.lookupSize()));
  }

  /** Geometry and adjacency of every face, edge and vertex (topological naming, fingerprints). */
  describe(shape: ShapeHandle): ShapeDescription {
    const f = this.#facade;
    if (f.describe(shape) < 0) throw new KernelError(f.lastError() || 'Unknown shape.');
    return decodeDescription(
      this.#copy(Int32Array, f.describeIntsPtr(), f.describeIntsSize()),
      this.#copy(Float64Array, f.describeNumbersPtr(), f.describeNumbersSize()),
    );
  }

  /**
   * The faces between planar curves (a sketch's profiles, P2-02): the curves
   * are split where they cross, touch or end on each other (positions within
   * `tolerance` mm are one), and each region between them becomes a face,
   * with the regions directly inside it as holes, placed in `frame`. Curves
   * that bound nothing (dangling lines, bridges to a hole) are left out.
   * Release the faces when done.
   */
  planarFaces(
    curves: readonly PlanarCurve[],
    frame: PlanarFrame,
    tolerance: number,
  ): PlanarFacesResult {
    const f = this.#facade;
    f.sketchClear();
    const staged: number[] = [];
    const skipped: number[] = [];
    curves.forEach((curve, i) => {
      if (this.#stageCurve(curve) < 0) skipped.push(i);
      else staged.push(i);
    });
    const { origin: o, x, normal: n } = frame;
    const count = f.sketchProfiles(o[0], o[1], o[2], x[0], x[1], x[2], n[0], n[1], n[2], tolerance);
    f.sketchClear();
    if (count < 0) throw new KernelError(f.lastError() || "Couldn't make the sketch's profiles.");
    const faces = decodePlanarFaces(
      this.#copy(Int32Array, f.profileRecordsPtr(), f.profileRecordsSize()),
      this.#copy(Float64Array, f.profileNumbersPtr(), f.profileNumbersSize()),
      staged,
    );
    return { faces, skipped };
  }

  /**
   * The exact geometry of edge `edge` of a shape (P2-09: what a sketch
   * projects), with `samples` points along it for curves that aren't lines.
   */
  edgeGeometry(shape: ShapeHandle, edge: number, samples = 24): EdgeGeometry {
    const f = this.#facade;
    if (!f.edgeGeometry(shape, edge, samples)) {
      throw new KernelError(f.lastError() || 'Unknown edge.');
    }
    return decodeEdgeGeometry(this.#copy(Float64Array, f.geometryPtr(), f.geometrySize()));
  }

  /**
   * The silhouette lines of face `face` seen along `direction`: the lines
   * of a cylinder or cone where its normal is square to the view, clipped
   * to the face (P2-09). None for other surfaces.
   */
  faceSilhouettes(shape: ShapeHandle, face: number, direction: Vec3): [Vec3, Vec3][] {
    const f = this.#facade;
    const n = f.faceSilhouettes(shape, face, direction[0], direction[1], direction[2]);
    if (n < 0) throw new KernelError(f.lastError() || 'Unknown face.');
    const v = this.#copy(Float64Array, f.geometryPtr(), f.geometrySize());
    const out: [Vec3, Vec3][] = [];
    for (let i = 0; i < n; i++) {
      const o = 6 * i;
      const at = (k: number) => v[o + k] as number;
      out.push([
        [at(0), at(1), at(2)],
        [at(3), at(4), at(5)],
      ]);
    }
    return out;
  }

  count(shape: ShapeHandle, kind: SubShapeKind): number {
    const n = this.#facade.count(shape, KIND_CODE[kind]);
    if (n < 0) throw new KernelError('Unknown shape.');
    return n;
  }

  isValid(shape: ShapeHandle): boolean {
    return this.#facade.isValid(shape);
  }

  measure(shape: ShapeHandle): Measurements {
    if (!this.#facade.measure(shape)) throw new KernelError(this.#facade.lastError());
    const m = (i: number) => this.#facade.measured(i);
    return {
      volume: m(0),
      area: m(1),
      bbox: { min: [m(2), m(3), m(4)], max: [m(5), m(6), m(7)] },
    };
  }

  /**
   * What the Measure tool shows of a shape (P2-13): volume of its solids,
   * area of its faces, length of its edges when it has no faces, the centre
   * of mass of the highest of those (a vertex's point), and a tight box
   * from the exact geometry (`measure`'s box may be looser).
   */
  properties(shape: ShapeHandle): ShapeProperties {
    if (!this.#facade.properties(shape)) throw new KernelError(this.#facade.lastError());
    const m = (i: number) => this.#facade.measured(i);
    return {
      volume: m(0),
      area: m(1),
      length: m(8),
      centroid: [m(9), m(10), m(11)],
      bbox: { min: [m(2), m(3), m(4)], max: [m(5), m(6), m(7)] },
    };
  }

  /** The surface under face `face` of a shape: its kind and, where it has them, axis and radii. */
  surfaceGeometry(shape: ShapeHandle, face: number): SurfaceGeometry {
    const f = this.#facade;
    if (!f.surfaceGeometry(shape, face)) throw new KernelError(f.lastError() || 'Unknown face.');
    return decodeSurfaceGeometry(this.#copy(Float64Array, f.geometryPtr(), f.geometrySize()));
  }

  mesh(shape: ShapeHandle, options: MeshOptions): BodyMesh {
    const f = this.#facade;
    if (!f.mesh(shape, options.linearDeflection, options.angularDeflection)) {
      throw new KernelError(f.lastError());
    }
    try {
      return {
        positions: this.#copy(Float32Array, f.positionsPtr(), f.positionsSize()),
        normals: this.#copy(Float32Array, f.normalsPtr(), f.normalsSize()),
        indices: this.#copy(Uint32Array, f.indicesPtr(), f.indicesSize()),
        faceRanges: this.#copy(Uint32Array, f.faceRangesPtr(), f.faceRangesSize()),
        edgePoints: this.#copy(Float32Array, f.edgePointsPtr(), f.edgePointsSize()),
        edgeRanges: this.#copy(Uint32Array, f.edgeRangesPtr(), f.edgeRangesSize()),
        edgeFlags: this.#copy(Uint8Array, f.edgeFlagsPtr(), f.edgeFlagsSize()),
        vertices: this.#copy(Float32Array, f.vertexPointsPtr(), f.vertexPointsSize()),
      };
    } finally {
      f.clearMesh();
    }
  }

  /**
   * Tessellates a shape for export (P2-12): welded nodes, so a closed
   * solid gives a closed, manifold mesh. It meshes a copy at the given
   * deflection, whatever the display mesh used.
   */
  exportMesh(shape: ShapeHandle, options: MeshOptions): ExportMesh {
    const f = this.#facade;
    if (f.exportMesh(shape, options.linearDeflection, options.angularDeflection) < 0) {
      throw new KernelError(f.lastError() || "Couldn't mesh the body.");
    }
    try {
      return {
        positions: this.#copy(Float64Array, f.exportPositionsPtr(), f.exportPositionsSize()),
        indices: this.#copy(Uint32Array, f.exportIndicesPtr(), f.exportIndicesSize()),
      };
    } finally {
      f.clearExport();
    }
  }

  /**
   * A STEP AP242 file (mm) of the shapes, each a product with its name
   * (P2-12). The text is ASCII.
   */
  writeStep(parts: readonly { shape: ShapeHandle; name: string }[]): string {
    const f = this.#facade;
    f.clearArgs();
    f.clearStepNames();
    for (const { shape, name } of parts) {
      f.pushArg(shape);
      f.pushStepName(stepString(name));
    }
    const size = f.writeStep();
    f.clearStepNames();
    if (size < 0) throw new KernelError(f.lastError() || "Couldn't write the STEP file.");
    try {
      return new TextDecoder('latin1').decode(this.#copy(Uint8Array, f.exportTextPtr(), size));
    } finally {
      f.clearExport();
    }
  }

  /** Reads STEP text into one shape (a compound of its roots). Release it when done. */
  readStep(text: string): ShapeHandle {
    return this.#check(this.#facade.readStep(text));
  }

  release(...shapes: ShapeHandle[]): void {
    for (const shape of shapes) this.#facade.release(shape);
  }

  /** Tracks handles and releases them all when the scope is disposed (`using`). */
  scope(): ShapeScope {
    return new ShapeScope(this);
  }

  stats(): KernelStats {
    return {
      liveShapes: this.#facade.liveShapes(),
      heapTop: this.#facade.heapTop(),
      heapBytes: this.#oc.wasmMemory.buffer.byteLength,
    };
  }

  /** Aborts the WASM instance on purpose. Only for the crash-recovery test. */
  debugAbort(): never {
    this.#facade.debugAbort();
    throw new Error('debugAbort returned');
  }

  /** Frees every shape and the facade itself. The kernel is unusable afterwards. */
  dispose(): void {
    this.#facade.releaseAll();
    this.#facade.delete();
  }

  /** Stages one curve for sketchProfiles; returns its facade index or -1. */
  #stageCurve(curve: PlanarCurve): number {
    const f = this.#facade;
    switch (curve.kind) {
      case 'line':
        return f.sketchLine(curve.a[0], curve.a[1], curve.b[0], curve.b[1]);
      case 'arc':
        return f.sketchArc(curve.center[0], curve.center[1], curve.radius, curve.from, curve.sweep);
      case 'ellipse':
        return f.sketchEllipse(curve.center[0], curve.center[1], curve.a, curve.b, curve.rotation);
      case 'spline':
        f.clearNumbers();
        for (const [px, py] of curve.poles) {
          f.pushNumber(px);
          f.pushNumber(py);
        }
        for (const knot of curve.knots) f.pushNumber(knot);
        return f.sketchSpline(curve.degree, curve.poles.length);
    }
  }

  #check(handle: number): ShapeHandle {
    if (handle === 0) {
      throw new KernelError(this.#facade.lastError() || 'The kernel operation failed.');
    }
    return handle as ShapeHandle;
  }

  #withHistory(handle: number): OperationResult {
    const shape = this.#check(handle);
    const history = decodeHistory(
      this.#copy(Int32Array, this.#facade.historyPtr(), this.#facade.historySize()),
    );
    return { shape, history };
  }

  /** Copies an array out of the WASM heap. Read the buffer fresh: it moves when memory grows. */
  #copy<T extends { slice(): T }>(Type: TypedArrayConstructor<T>, ptr: number, length: number): T {
    return new Type(this.#oc.wasmMemory.buffer as ArrayBuffer, ptr, length).slice();
  }
}

/**
 * Text as a STEP string's content (ISO 10303-21): printable ASCII as is;
 * other characters (and the backslash, which starts a directive) as
 * `\X2\…\X0\` (4 hex digits each) or, beyond the BMP, `\X4\…\X0\` (8).
 * Control characters are dropped. The writer doubles apostrophes.
 */
export function stepString(text: string): string {
  let out = '';
  let run: { width: 4 | 8; hex: string } | undefined;
  const flush = () => {
    if (run) out += `\\X${run.width / 2}\\${run.hex}\\X0\\`;
    run = undefined;
  };
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code >= 0x20 && code < 0x7f && code !== 0x5c) {
      flush();
      out += char;
    } else if (code > 0x9f || code === 0x5c) {
      const width = code > 0xffff ? 8 : 4;
      if (run?.width !== width) flush();
      run ??= { width, hex: '' };
      run.hex += code.toString(16).toUpperCase().padStart(width, '0');
    }
  }
  flush();
  return out;
}

/** A body edge's geometry (`Kernel.edgeGeometry`), in world mm. */
export type EdgeGeometry =
  | { type: 'degenerate' }
  | {
      type: 'line' | 'circle' | 'ellipse' | 'other';
      closed: boolean;
      /** Points along the edge, ends included, evenly spaced in its parameter. */
      points: Vec3[];
      /** Circles and ellipses. */
      conic?: {
        center: Vec3;
        axis: Vec3;
        /** The x (circle) or major (ellipse) direction, from which angles count. */
        xDirection: Vec3;
        /** Radius, or major radius. */
        radius: number;
        /** Ellipses: the minor radius. */
        minor?: number;
        /** Angles about the axis from the x direction, radians. */
        first: number;
        last: number;
      };
    };

/** Decodes the facade's edgeGeometry numbers. */
export function decodeEdgeGeometry(v: Float64Array): EdgeGeometry {
  let k = 0;
  const num = () => v[k++] as number;
  const vec = (): Vec3 => [num(), num(), num()];
  const code = num();
  if (code < 0) return { type: 'degenerate' };
  const closed = num() !== 0;
  const n = num();
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) points.push(vec());
  const type = code === 0 ? 'line' : code === 1 ? 'circle' : code === 2 ? 'ellipse' : 'other';
  if (type === 'circle') {
    const [center, axis, xDirection] = [vec(), vec(), vec()];
    const radius = num();
    return {
      type,
      closed,
      points,
      conic: { center, axis, xDirection, radius, first: num(), last: num() },
    };
  }
  if (type === 'ellipse') {
    const [center, axis, xDirection] = [vec(), vec(), vec()];
    const radius = num();
    const minor = num();
    return {
      type,
      closed,
      points,
      conic: { center, axis, xDirection, radius, minor, first: num(), last: num() },
    };
  }
  return { type, closed, points };
}

/** Decodes the facade's fillet diagnosis: [status, n, n × [m, edge × m, value]]. */
export function decodeFilletProblems(v: Float64Array): FilletProblem[] {
  if (v.length < 2) return [{ kind: 'other' }];
  const status = v[0] as number;
  const count = v[1] as number;
  const problems: FilletProblem[] = [];
  let k = 2;
  for (let n = 0; n < count; n++) {
    const m = v[k++] as number;
    const edges = Array.from(v.subarray(k, k + m), (x) => Math.round(x));
    k += m;
    const value = v[k++] as number;
    if (status === 1) problems.push({ kind: 'too-large', edges, max: value });
    else if (status === 2) problems.push({ kind: 'unfilletable', edges });
    else if (status === 3) problems.push({ kind: 'mixed-radii', edges });
    else if (status === 4) problems.push({ kind: 'together', edges, factor: value });
  }
  return problems.length > 0 ? problems : [{ kind: 'other' }];
}

/** Decodes the facade's chamfer diagnosis (fillet's layout): [status, n, n × [m, edge × m, value]]. */
export function decodeChamferProblems(v: Float64Array): ChamferProblem[] {
  if (v.length < 2) return [{ kind: 'other' }];
  const status = v[0] as number;
  const count = v[1] as number;
  const problems: ChamferProblem[] = [];
  let k = 2;
  for (let n = 0; n < count; n++) {
    const m = v[k++] as number;
    const edges = Array.from(v.subarray(k, k + m), (x) => Math.round(x));
    k += m;
    const value = v[k++] as number;
    if (status === 1) problems.push({ kind: 'too-large', edges, factor: value });
    else if (status === 2) problems.push({ kind: 'unchamferable', edges });
    else if (status === 3) problems.push({ kind: 'mixed', edges });
    else if (status === 4) problems.push({ kind: 'together', edges, factor: value });
  }
  return problems.length > 0 ? problems : [{ kind: 'other' }];
}

/** `Kernel.properties`: lengths in mm, areas in mm², volumes in mm³. */
export interface ShapeProperties {
  volume: number;
  area: number;
  length: number;
  centroid: Vec3;
  bbox: { min: Vec3; max: Vec3 };
}

/** The facade's surface type codes (as `describe` gives them). */
const SURFACE_KINDS = [
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
] as const;

/** A face's surface (`Kernel.surfaceGeometry`), in world mm. */
export interface SurfaceGeometry {
  type: (typeof SURFACE_KINDS)[number] | 'other';
  /**
   * A plane: a point on it. A cylinder, a revolution: a point on the axis.
   * A cone: the apex. A sphere, a torus: the centre.
   */
  origin?: Vec3;
  /**
   * A plane: its normal out of the face. Otherwise the axis (a sphere's
   * polar one; an extrusion's direction), sign canonical.
   */
  direction?: Vec3;
  /** Cylinder, sphere; a cone's radius at its reference plane; a torus's major radius. */
  radius?: number;
  /** A torus: the minor radius. */
  minorRadius?: number;
  /** A cone: the half angle, radians. */
  halfAngle?: number;
}

/** Decodes the facade's surfaceGeometry numbers. */
export function decodeSurfaceGeometry(v: Float64Array): SurfaceGeometry {
  const type = SURFACE_KINDS[v[0] as number] ?? 'other';
  if (v.length < 9) return { type };
  const at = (k: number) => v[k] as number;
  const out: SurfaceGeometry = {
    type,
    origin: [at(1), at(2), at(3)],
    direction: [at(4), at(5), at(6)],
  };
  if (type === 'cylinder' || type === 'sphere' || type === 'cone' || type === 'torus') {
    out.radius = at(7);
  }
  if (type === 'torus') out.minorRadius = at(8);
  if (type === 'cone') out.halfAngle = at(8);
  if (type === 'extrusion') delete out.origin;
  return out;
}

/** Releases every tracked shape on dispose, in reverse order. */
export class ShapeScope implements Disposable {
  readonly #kernel: Kernel;
  readonly #shapes: ShapeHandle[] = [];

  constructor(kernel: Kernel) {
    this.#kernel = kernel;
  }

  track<T extends ShapeHandle | OperationResult>(value: T): T {
    this.#shapes.push(typeof value === 'number' ? value : value.shape);
    return value;
  }

  /** Stops tracking a shape, so it outlives the scope: the result a function returns. */
  keep(shape: ShapeHandle): ShapeHandle {
    const index = this.#shapes.lastIndexOf(shape);
    if (index >= 0) this.#shapes.splice(index, 1);
    return shape;
  }

  [Symbol.dispose](): void {
    this.#kernel.release(...this.#shapes.reverse());
    this.#shapes.length = 0;
  }
}
