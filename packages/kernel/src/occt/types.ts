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
  clearNumbers(): void;
  pushNumber(value: number): void;
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
  fillet(shape: number): number;
  filletVariable(shape: number): number;
  tangentChain(shape: number, edge: number): number;
  chamfer(shape: number): number;
  shell(shape: number, thickness: number, outside: boolean): number;
  clearWalls(): void;
  pushWall(face: number, thickness: number): void;
  shellFaces(shape: number, thickness: number, outside: boolean): number;
  offsetFaces(shape: number, distance: number): number;
  tangentFaces(shape: number, face: number): number;
  boolean(op: number, a: number, b: number, simplify: boolean): number;
  extendFace(shape: number, face: number, size: number): number;
  transform(shape: number): number;
  scale(shape: number): number;
  draft(
    shape: number,
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    angle: number,
  ): number;
  prism(
    shape: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    taper: number,
  ): number;
  revolve(
    shape: number,
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    angle: number,
  ): number;
  pathClear(): void;
  pathSketch(
    ox: number,
    oy: number,
    oz: number,
    xx: number,
    xy: number,
    xz: number,
    nx: number,
    ny: number,
    nz: number,
  ): number;
  pathEdge(shape: number, edge: number): number;
  pathWire(tolerance: number): number;
  helix(
    ox: number,
    oy: number,
    oz: number,
    zx: number,
    zy: number,
    zz: number,
    xx: number,
    xy: number,
    xz: number,
    radius: number,
    pitch: number,
    turns: number,
    taper: number,
    left: boolean,
  ): number;
  sweep(
    profile: number,
    spine: number,
    mode: number,
    twist: number,
    scale: number,
    verify: boolean,
    dx: number,
    dy: number,
    dz: number,
  ): number;
  loft(ruled: boolean, closed: boolean): number;
  compound(): number;
  subShape(shape: number, kind: number, index: number): number;
  locate(part: number, whole: number, kind: number): number;
  distance(a: number, b: number): number;
  lookupPtr(): number;
  lookupSize(): number;
  describe(shape: number): number;
  describeIntsPtr(): number;
  describeIntsSize(): number;
  describeNumbersPtr(): number;
  describeNumbersSize(): number;
  edgeGeometry(shape: number, edge: number, samples: number): number;
  faceSilhouettes(
    shape: number,
    face: number,
    dx: number,
    dy: number,
    dz: number,
    deflection: number,
  ): number;
  sectionWithPlane(
    shape: number,
    ox: number,
    oy: number,
    oz: number,
    nx: number,
    ny: number,
    nz: number,
    deflection: number,
  ): number;
  edgeVisibility(shape: number, dx: number, dy: number, dz: number): number;
  geometryPtr(): number;
  geometrySize(): number;
  sketchClear(): void;
  sketchLine(x0: number, y0: number, x1: number, y1: number): number;
  sketchArc(cx: number, cy: number, radius: number, from: number, sweep: number): number;
  sketchEllipse(cx: number, cy: number, a: number, b: number, rotation: number): number;
  sketchSpline(degree: number, poleCount: number): number;
  sketchConic(
    x0: number,
    y0: number,
    xs: number,
    ys: number,
    x1: number,
    y1: number,
    rho: number,
  ): number;
  sketchProfiles(
    ox: number,
    oy: number,
    oz: number,
    xx: number,
    xy: number,
    xz: number,
    nx: number,
    ny: number,
    nz: number,
    fuzzy: number,
  ): number;
  profileRecordsPtr(): number;
  profileRecordsSize(): number;
  profileNumbersPtr(): number;
  profileNumbersSize(): number;
  historyPtr(): number;
  historySize(): number;
  count(shape: number, kind: number): number;
  isValid(shape: number): boolean;
  measure(shape: number): boolean;
  measured(index: number): number;
  properties(shape: number): boolean;
  surfaceGeometry(shape: number, face: number): number;
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
  edgeFlagsPtr(): number;
  edgeFlagsSize(): number;
  vertexPointsPtr(): number;
  vertexPointsSize(): number;
  exportMesh(shape: number, linearDeflection: number, angularDeflection: number): number;
  clearStepNames(): void;
  pushStepName(name: string): void;
  clearStepColors(): void;
  stageStepColor(r: number, g: number, b: number): void;
  writeStep(): number;
  readStep(text: string): number;
  readStepColors(text: string): number;
  clearExport(): void;
  exportPositionsPtr(): number;
  exportPositionsSize(): number;
  exportIndicesPtr(): number;
  exportIndicesSize(): number;
  exportTextPtr(): number;
  exportTextSize(): number;
  lastError(): string;
  heapTop(): number;
  debugAbort(): void;
  wrapOnCylinder(
    face: number,
    ox: number,
    oy: number,
    oz: number,
    ax: number,
    ay: number,
    az: number,
    rx: number,
    ry: number,
    rz: number,
    radius: number,
    px: number,
    py: number,
    pz: number,
    sx: number,
    sy: number,
    sz: number,
    depth: number,
    outward: boolean,
  ): number;
  threadSweep(
    profile: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    pitch: number,
    turns: number,
    left: boolean,
    taper: number,
  ): number;
  threadFace(shape: number, face: number): number;
  wrapOnCone(
    face: number,
    ox: number,
    oy: number,
    oz: number,
    ax: number,
    ay: number,
    az: number,
    rx: number,
    ry: number,
    rz: number,
    radius: number,
    halfAngle: number,
    px: number,
    py: number,
    pz: number,
    sx: number,
    sy: number,
    sz: number,
    depth: number,
    outward: boolean,
  ): number;
  coneFace(shape: number, face: number): number;
  projectOnFace(
    profile: number,
    shape: number,
    face: number,
    depth: number,
    outward: boolean,
  ): number;
  delete(): void;
}

/** An initialised OCCT module. Raw bindings are reached through `raw` (see scope.ts). */
export interface OcctModule {
  ExtrudoFacade: new () => FacadeBinding;
  wasmMemory: WebAssembly.Memory;
}
