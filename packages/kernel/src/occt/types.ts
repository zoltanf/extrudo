/**
 * The parts of our OCCT WASM module (packages/kernel/occt) that the kernel
 * uses, typed by hand. The generated declarations cover every binding; this
 * narrow view documents the facade contract and keeps the rest of the kernel
 * off the raw OCCT surface.
 */

/** Our C++ facade (occt/facade/extrudo_facade.cpp). See that file for the conventions. */
export interface FacadeBinding {
  liveShapes(): number;
  release(handle: number): void;
  releaseAll(): void;
  clearArgs(): void;
  pushArg(value: number): void;
  makeBox(x: number, y: number, z: number, dx: number, dy: number, dz: number): number;
  makeCylinder(
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    radius: number,
    height: number,
  ): number;
  fillet(shape: number, radius: number): number;
  boolean(op: number, a: number, b: number): number;
  historyPtr(): number;
  historySize(): number;
  count(shape: number, kind: number): number;
  isValid(shape: number): boolean;
  measure(shape: number): boolean;
  measured(index: number): number;
  mesh(shape: number, linearDeflection: number, angularDeflection: number): boolean;
  clearMesh(): void;
  positionsPtr(): number;
  positionsSize(): number;
  normalsPtr(): number;
  normalsSize(): number;
  indicesPtr(): number;
  indicesSize(): number;
  faceRangesPtr(): number;
  faceRangesSize(): number;
  edgePointsPtr(): number;
  edgePointsSize(): number;
  edgeRangesPtr(): number;
  edgeRangesSize(): number;
  vertexPointsPtr(): number;
  vertexPointsSize(): number;
  lastError(): string;
  heapTop(): number;
  debugAbort(): void;
  delete(): void;
}

/** An initialised OCCT module. Raw bindings are reached through `raw` (see scope.ts). */
export interface OcctModule {
  ExtrudoFacade: new () => FacadeBinding;
  wasmMemory: WebAssembly.Memory;
}
