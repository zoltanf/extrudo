import { decodeHistory, type HistoryRecord, type SubShapeKind } from './history';
import type { BodyMesh, Measurements, MeshOptions } from './mesh';
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

  /** Fillets edges (indices into the shape's edge list) with one radius. */
  fillet(shape: ShapeHandle, edges: readonly number[], radius: number): OperationResult {
    this.#facade.clearArgs();
    for (const edge of edges) this.#facade.pushArg(edge);
    return this.#withHistory(this.#facade.fillet(shape, radius));
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
   * Sweeps a shape (a face, a compound of faces) along `vector`, after
   * moving it by `shift`: an extrude that starts off its plane (symmetric,
   * two sides) sweeps the shifted profile. History (input 0, indices of the
   * shape as passed in): `generated` (edge → side face, vertex → side
   * edge), `first` and `last` (the copies at the start and end).
   */
  prism(shape: ShapeHandle, vector: Vec3, shift: Vec3 = [0, 0, 0]): OperationResult {
    return this.#withHistory(this.#facade.prism(shape, ...shift, ...vector));
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
