import { decodeHistory, type HistoryRecord, type SubShapeKind } from './history';
import type { BodyMesh, Measurements, MeshOptions } from './mesh';
import type { FacadeBinding, OcctModule } from './occt/types';

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

  cut(target: ShapeHandle, tool: ShapeHandle): OperationResult {
    return this.#withHistory(this.#facade.boolean(BOOLEAN_CODE.cut, target, tool));
  }

  fuse(target: ShapeHandle, tool: ShapeHandle): OperationResult {
    return this.#withHistory(this.#facade.boolean(BOOLEAN_CODE.fuse, target, tool));
  }

  common(target: ShapeHandle, tool: ShapeHandle): OperationResult {
    return this.#withHistory(this.#facade.boolean(BOOLEAN_CODE.common, target, tool));
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
