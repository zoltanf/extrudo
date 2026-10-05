import { checkManifold, type TriangleMesh } from '@extrudo/io';
import { decodeHistory, type HistoryRecord, type SubShapeKind } from './history';
import type { Manifold, ManifoldToplevel, Mat4 } from './manifold';
import type { BodyMesh, ExportMesh, Measurements, MeshOptions } from './mesh';
import { displayMesh } from './mesh-body';
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

/**
 * Handles from here up are mesh bodies (P4-06, ADR-0066 §3): a
 * manifold-3d `Manifold` the `Kernel` owns instead of an OCCT shape. The
 * arena's handles are small numbers, so the two kinds of body are one kind of
 * handle to the engine and every cache, scope and leak count works unchanged.
 */
export const MESH_HANDLE_BASE = 2 ** 30;

/**
 * How finely a solid is meshed when a boolean or a gap test meets a mesh body
 * (P4-06, ADR-0066 §4). The mesh has to be closed and manifold by
 * construction, which is what `exportMesh` gives (ADR-0034), and fine enough
 * that the result is the shape the user asked for: 0.01 mm and 0.1 rad, the
 * fine end of what the view draws at.
 */
export const MESH_BOOLEAN_DEFLECTION: MeshOptions = {
  linearDeflection: 0.01,
  angularDeflection: 0.1,
};

/** A cylindrical face as a thread sees it (`Kernel.threadFace`). */
export interface ThreadFace {
  /** The cylinder's axis (canonical sign: first non-zero component positive). */
  axis: Axis;
  radius: number;
  /** The face is a hole's wall (material outside it): an internal thread. */
  inside: boolean;
  /** Where the face starts and ends along the axis, from `axis.origin` (mm). */
  from: number;
  to: number;
  /** The face goes all the way round. */
  whole: boolean;
  /** Whether the face's edge at `from` / `to` is an outward corner: a shaft's end, a hole's mouth. */
  open: [boolean, boolean];
}

/** A kernel operation failed in a way the user can act on (bad radius, …). */
export class KernelError extends Error {
  override name = 'KernelError';
}

/** What a mesh file isn't, in the counts `checkManifold` found (P4-06). */
export interface MeshProblem {
  /** Edges used by one triangle only: holes in the surface. */
  openEdges: number;
  /** Edges used by more than two triangles. */
  nonManifoldEdges: number;
  /** Edges whose two triangles run along it the same way. */
  misorientedEdges: number;
  /** Triangles that repeat a node or name one that doesn't exist. */
  badTriangles: number;
  /** Nodes with a coordinate that isn't a finite number. */
  badNodes: number;
  /**
   * The volume the triangles enclose in mm³ (signed): negative when the whole
   * mesh faces inwards, which is closed and consistent but inside-out.
   */
  volume: number;
}

/**
 * A mesh isn't a closed, oriented solid, or is too big (P4-06, ADR-0066 §3):
 * what `checkManifold` found, so the message can count the open edges.
 */
export class MeshError extends KernelError {
  override name = 'MeshError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly problem: MeshProblem | undefined;
  constructor(message: string, problem?: MeshProblem) {
    super(message);
    this.problem = problem;
  }
}

/**
 * An operation needs B-rep geometry and was given a mesh body (P4-06,
 * ADR-0066 §3): one message from the kernel, so every feature that refuses a
 * mesh says the same thing.
 */
export class MeshBodyError extends KernelError {
  override name = 'MeshBodyError';
}

/**
 * The message a refused operation shows: `Mesh needs a solid body: this body
 * is a mesh (imported, or combined with a mesh).`
 */
export function meshBodyMessage(operation: string): string {
  return `${operation} needs a solid body: this body is a mesh (imported, or combined with a mesh).`;
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
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly problems: readonly FilletProblem[];
  constructor(message: string, problems: readonly FilletProblem[]) {
    super(message);
    this.problems = problems;
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
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly problems: readonly ChamferProblem[];
  constructor(message: string, problems: readonly ChamferProblem[]) {
    super(message);
    this.problems = problems;
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

/**
 * Why a shell failed (P3-03, ADR-0046): the facade's diagnosis. Face indices
 * are the shape's.
 */
export type ShellProblem =
  /** The thickness is too large for the body; `max` is the largest that works (mm). */
  | { kind: 'too-thick'; max: number }
  /** OCCT can't offset the body at any thickness worth trying (fillets, tangent faces). */
  | { kind: 'unshellable' }
  /** Every face was picked for removal. */
  | { kind: 'all-faces' }
  /** The shape isn't a solid. */
  | { kind: 'not-solid' }
  /** A removed face runs smoothly into a neighbour (next to a fillet): OCCT can't open it. */
  | { kind: 'tangent'; face: number }
  | { kind: 'other' };

/** A shell OCCT couldn't build, with its diagnosis. */
export class ShellError extends KernelError {
  override name = 'ShellError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly problems: readonly ShellProblem[];
  constructor(message: string, problems: readonly ShellProblem[]) {
    super(message);
    this.problems = problems;
  }
}

/** Which side of a body's surface the walls of a shell are built on. */
export type ShellSide = 'inside' | 'outside';

/** Why moving faces failed (P3-08, ADR-0051): the facade's diagnosis. */
export type OffsetFaceProblem =
  /** The distance is too large for the body; `max` is the largest that works (mm, a magnitude). */
  | { kind: 'too-far'; max: number }
  /** OCCT can't offset these faces at any distance worth trying. */
  | { kind: 'unoffsettable' }
  /** The shape isn't a solid. */
  | { kind: 'not-solid' }
  /** The solid has an inner void (more than one shell). */
  | { kind: 'void' }
  /**
   * Some smooth chain of faces has a sharp edge inside it (fillets that meet at a corner
   * without a blend): OCCT's offset traps on such bodies, so it isn't tried.
   */
  | { kind: 'sharp-chain' }
  | { kind: 'other' };

/** An offset OCCT couldn't build, with its diagnosis. */
export class OffsetFaceError extends KernelError {
  override name = 'OffsetFaceError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly problems: readonly OffsetFaceProblem[];
  constructor(message: string, problems: readonly OffsetFaceProblem[]) {
    super(message);
    this.problems = problems;
  }
}

/** Why tilting faces failed (P3-08, draft): the facade's diagnosis. */
export type DraftProblem =
  /** The angle is too steep for the body; `max` is the largest that works (degrees, a magnitude). */
  | { kind: 'too-steep'; max: number }
  /** OCCT can't tilt this face about the neutral plane (its neighbours can't follow). */
  | { kind: 'refused'; face: number }
  /** The face isn't flat, cylindrical or conical. */
  | { kind: 'surface'; face: number }
  /** The face is parallel to the neutral plane: there is no line to turn it about. */
  | { kind: 'parallel'; face: number }
  /** No angle worth trying works. */
  | { kind: 'undraftable' }
  /** The shape isn't a solid. */
  | { kind: 'not-solid' }
  | { kind: 'other' };

/** A draft OCCT couldn't build, with its diagnosis. */
export class DraftError extends KernelError {
  override name = 'DraftError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly problems: readonly DraftProblem[];
  constructor(message: string, problems: readonly DraftProblem[]) {
    super(message);
    this.problems = problems;
  }
}

/** Why a sweep failed (P4-01): the facade's status. */
export type SweepProblem =
  /** OCCT couldn't sweep it: a section too large for a tight turn, a corner it can't mitre. */
  | { kind: 'failed' }
  /** The result crosses itself or isn't a sound solid. */
  | { kind: 'crosses' }
  /** A twist along a path with a sharp corner. */
  | { kind: 'twist-corner' }
  /** A scale along a closed path. */
  | { kind: 'closed-scale' };

/** A sweep OCCT couldn't build, with its reason. */
export class SweepError extends KernelError {
  override name = 'SweepError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly problem: SweepProblem;
  constructor(message: string, problem: SweepProblem) {
    super(message);
    this.problem = problem;
  }
}

/** Why a loft failed (P4-01): the facade's status and the section it concerns. */
export type LoftProblem =
  | { kind: 'failed' }
  | { kind: 'crosses' }
  | { kind: 'holes'; section: number }
  | { kind: 'not-one-face'; section: number }
  | { kind: 'point-inside'; section: number };

/** A loft OCCT couldn't build, with its reason. */
export class LoftError extends KernelError {
  override name = 'LoftError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly problem: LoftProblem;
  constructor(message: string, problem: LoftProblem) {
    super(message);
    this.problem = problem;
  }
}

/** The pieces of a path (P4-01): exact sketch curves placed in their plane, and edges of shapes. */
export type PathPiece =
  | { kind: 'curve'; curve: PlanarCurve; frame: PlanarFrame }
  | { kind: 'edge'; shape: ShapeHandle; edge: number };

/** A path pieces couldn't be chained into: `apart` of them don't meet the rest. */
export class PathError extends KernelError {
  override name = 'PathError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly apart: number;
  constructor(message: string, apart: number) {
    super(message);
    this.apart = apart;
  }
}

/** A helix (a coil's path, P4-01; P4-02's threads reuse it). */
export interface HelixOptions {
  /** On the axis, at the helix's start height. */
  origin: Vec3;
  /** The axis direction: the helix rises along it. */
  axis: Vec3;
  /** Towards the start point from the axis (made square to the axis). */
  start: Vec3;
  /** At the start, mm. */
  radius: number;
  /** Rise per turn along the axis, mm. */
  pitch: number;
  /** Fractions allowed. */
  turns: number;
  /** Half-angle of the cone it winds on, radians: positive widens with height. Default 0. */
  taper?: number;
  /** Clockwise seen from the axis's tip (a left-handed helix). Default false. */
  left?: boolean;
}

/**
 * How a swept profile turns with its path: `follow` keeps its angle to the
 * path, `fixed` keeps it parallel to itself, `binormal` keeps its angle to a
 * fixed direction (a coil's axis).
 */
export type SweepOrientation = 'follow' | 'fixed' | { binormal: Vec3 };

export interface SweepOptions {
  /** Default `follow`. */
  orientation?: SweepOrientation;
  /** Radians the profile turns about the path from start to end (`follow` only, smooth paths). */
  twist?: number;
  /** The profile's scale at the end (1 at the start), > 0. Not on a closed path. */
  scale?: number;
  /**
   * Check a result that might cross itself (a tight bend, a path coming back
   * near itself). Default true; a coil checks its own sizes and turns it off.
   */
  verify?: boolean;
}

/** A loft section: a shape holding one face, or a point (first or last only). */
export type LoftSection = ShapeHandle | { point: Vec3 };

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

/**
 * The unrolled sketch frame of `wrapOnCylinder` (P4-04, ADR-0060 §3): the
 * cylinder and where the sketch plane sits on it. A sketch point measured in
 * that plane as `s` along `across` from `corner` and `z` along the axis lands
 * on the cylinder at angle `s / radius` from `reference` and height `z`, so
 * the letters keep their width measured along the surface.
 */
export interface WrapFrame {
  /** A point on the cylinder's axis. */
  origin: Vec3;
  /** The axis's direction. */
  axis: Vec3;
  /** The direction from the axis towards the sketch, square to the axis: angle zero. */
  reference: Vec3;
  /** The cylinder's radius in mm. */
  radius: number;
  /** Where `across` meets the sketch plane: the sketch's `s = 0`. */
  corner: Vec3;
  /** The in-plane direction the sketch's `s` runs along, square to the axis. */
  across: Vec3;
}

export interface KernelStats {
  /** Shapes held in the arena. */
  liveShapes: number;
  /** Top of the malloc heap in bytes (grows only; see heapTop() in the facade). */
  heapTop: number;
  /** Size of the WASM memory in bytes. */
  heapBytes: number;
}

/**
 * How much of the WASM heap is in use (P4-12 H4, ADR-0067 §H4): `top` is the
 * top of the malloc heap, which only ever grows (OCCT's mesher asks for 16 MB
 * blocks), and `size` the whole WASM memory. The Recomputer reads this after
 * each recompute and replaces the worker when `top` passes its limit.
 */
export interface HeapUsage {
  /** Top of the malloc heap, in bytes. */
  top: number;
  /** Size of the WASM memory, in bytes. */
  size: number;
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
  /** Mesh bodies (ADR-0066 §3), by handle; `enableMeshes` must come first. */
  readonly #meshes = new Map<number, Manifold>();
  #manifold: ManifoldToplevel | undefined;
  #nextMesh = MESH_HANDLE_BASE;

  constructor(oc: OcctModule) {
    this.#oc = oc;
    this.#facade = new oc.ExtrudoFacade();
  }

  /**
   * Hands the kernel the manifold-3d module, which mesh bodies need
   * (P4-06, ADR-0066 §3). The app's `KernelService` calls this when a document
   * imports a mesh file, and Node calls `loadManifold` for it: a design
   * without a mesh body never loads the second WASM.
   */
  enableMeshes(module: ManifoldToplevel): void {
    this.#manifold = module;
  }

  /** Whether mesh bodies can be made (the module is loaded). */
  meshesEnabled(): boolean {
    return this.#manifold !== undefined;
  }

  /** Whether a handle is a mesh body rather than an OCCT shape. */
  isMesh(shape: ShapeHandle): boolean {
    return shape >= MESH_HANDLE_BASE;
  }

  /**
   * A mesh body from triangles (P4-06, ADR-0066 §3): the nodes are welded
   * (`Mesh.merge()`) and the result is one closed, oriented manifold-3d
   * solid, whose handles are the body. A mesh that isn't closed is refused
   * with a `MeshError` carrying what `checkManifold` found, so the feature can
   * word the message with the file's name.
   */
  meshFrom(mesh: TriangleMesh): ShapeHandle {
    const module = this.#manifold;
    if (!module) {
      throw new KernelError(
        "Mesh bodies need the mesh kernel, which isn't loaded (the document has no mesh import).",
      );
    }
    const report = checkManifold(mesh);
    const problem: MeshProblem = {
      openEdges: report.boundaryEdges,
      nonManifoldEdges: report.nonManifoldEdges,
      misorientedEdges: report.misorientedEdges,
      badTriangles: report.badTriangles,
      badNodes: report.badNodes,
      volume: report.volume,
    };
    if (!report.ok) throw new MeshError(meshNotSolid(problem), problem);
    const gl = new module.Mesh({
      numProp: 3,
      vertProperties: Float32Array.from(mesh.positions),
      triVerts: mesh.indices,
    });
    // Weld the corners that are the same point but sit apart in the file.
    gl.merge();
    let manifold: Manifold | undefined;
    try {
      manifold = new module.Manifold(gl);
    } catch (error) {
      throw new MeshError(
        `This mesh isn't a solid Extrudo can use: ${error instanceof Error ? error.message : String(error)}.`,
        problem,
      );
    }
    const status = manifold.status();
    if (manifold.isEmpty() || status !== 'NoError') {
      manifold.delete();
      throw new MeshError(`This mesh isn't a solid Extrudo can use (${status}).`, problem);
    }
    return this.#meshHandle(manifold);
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
    this.#solid(shape, 'Fillet');
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
   * Fillets edges (indices into the shape's edge list) with a radius that
   * changes along each chain of tangent-continuous edges: one [start, end]
   * pair per edge, or one pair for all of them. The radius runs from the start
   * radius at the chain's start (whichever end OCCT calls that) to the end
   * radius at its other end. As in a constant fillet, edges of one chain must
   * all give the same pair. A failure is a `FilletError` with the facade's
   * diagnosis; with a taper only the factor every radius scales by is reported,
   * since which chain is too large depends on the direction the radius runs in.
   * History: input 0; a filleted edge is deleted and generates its face.
   */
  filletVariable(
    shape: ShapeHandle,
    edges: readonly number[],
    radii: readonly (readonly [number, number])[],
  ): OperationResult {
    this.#solid(shape, 'Fillet');
    const f = this.#facade;
    f.clearArgs();
    f.clearNumbers();
    edges.forEach((edge, i) => {
      const pair = radii[i];
      if (!pair) throw new KernelError(`No radii given for edge ${i + 1}.`);
      f.pushArg(edge);
      f.pushNumber(pair[0]);
      f.pushNumber(pair[1]);
    });
    const handle = f.filletVariable(shape);
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
    this.#solid(shape, 'Fillet');
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
    this.#solid(shape, 'Chamfer');
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

  /**
   * Hollows a solid (P3-03): walls of `thickness` mm built `inside` (the
   * outside stays where it is) or `outside` (the surface becomes the cavity
   * and the part grows). `faces` (indices into the shape's face list) are
   * removed as openings; none makes a closed hollow solid with a void. A
   * failure is a `ShellError` with the facade's diagnosis. History: input 0;
   * the faces that stay are kept and each generates its offset face, a
   * removed face is modified into the rim around the opening, edges and
   * vertices of the surface generate the rounded joins.
   */
  shell(
    shape: ShapeHandle,
    faces: readonly number[],
    thickness: number,
    side: ShellSide = 'inside',
  ): OperationResult {
    this.#solid(shape, 'Shell');
    const f = this.#facade;
    f.clearArgs();
    for (const face of faces) f.pushArg(face);
    const handle = f.shell(shape, thickness, side === 'outside');
    if (handle === 0) {
      throw new ShellError(
        f.lastError() || 'The shell failed.',
        decodeShellProblems(this.#copy(Float64Array, f.geometryPtr(), f.geometrySize())),
      );
    }
    return this.#withHistory(handle);
  }

  /**
   * Moves faces of a solid (P3-08): each of `faces` (indices into the
   * shape's face list) by `distance` mm along its outward normal (positive
   * grows the body there, negative cuts into it), the faces next to them
   * extended or trimmed to follow. OCCT moves the faces that run smoothly
   * into a picked one with it (`tangentFaces`). A failure is an
   * `OffsetFaceError` with the facade's diagnosis. History: input 0; every
   * face generates its offset image, a face the offset swallows is deleted.
   */
  offsetFaces(shape: ShapeHandle, faces: readonly number[], distance: number): OperationResult {
    this.#solid(shape, 'Press Pull');
    const f = this.#facade;
    f.clearArgs();
    for (const face of faces) f.pushArg(face);
    const handle = f.offsetFaces(shape, distance);
    if (handle === 0) {
      throw new OffsetFaceError(
        f.lastError() || 'The offset failed.',
        decodeOffsetFaceProblems(this.#copy(Float64Array, f.geometryPtr(), f.geometrySize())),
      );
    }
    return this.#withHistory(handle);
  }

  /**
   * The faces (indices) of the smooth chain around `face`, the face
   * included: the faces `offsetFaces` moves together with it.
   */
  tangentFaces(shape: ShapeHandle, face: number): number[] {
    this.#solid(shape, 'Press Pull');
    const f = this.#facade;
    if (f.tangentFaces(shape, face) < 0) throw new KernelError(f.lastError() || 'Unknown face.');
    return Array.from(this.#copy(Int32Array, f.lookupPtr(), f.lookupSize()));
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
    // A mesh operand takes the whole boolean to manifold-3d (P4-06,
    // ADR-0066 §4): a B-rep operand is meshed at `MESH_BOOLEAN_DEFLECTION`
    // and the result is a mesh body, with no history (there are no B-rep
    // sub-shapes to carry names through).
    if (this.isMesh(target) || this.isMesh(tool)) {
      return { shape: this.#meshBoolean(op, target, tool), history: [] };
    }
    const code = BOOLEAN_CODE[op];
    return this.#withHistory(this.#facade.boolean(code, target, tool, options.simplify ?? false));
  }

  /**
   * The gap between two bodies in mm: 0 where they touch, overlap or one lies
   * inside the other, and how far apart they are otherwise, found within
   * `search` mm (`search` caps the answer). The distance features ask "do these
   * touch?" — `touchingBodies`, a Combine's join order, a Mirror's copy — and
   * a mesh body has no B-rep distance, so a pair with a mesh in it is answered
   * by manifold-3d's own `minGap` with the other operand meshed as above.
   * `search` caps the answer, so it is the range the caller is sure about.
   */
  minGap(a: ShapeHandle, b: ShapeHandle, search = 1): number {
    if (!this.isMesh(a) && !this.isMesh(b)) return this.distance(a, b);
    const left = this.#manifoldFor(a);
    const right = this.#manifoldFor(b);
    try {
      return left.minGap(right, search);
    } finally {
      // The manifolds built here are ours to free; one that came from a handle
      // is the body's own and stays (`#meshOwned` says which).
      if (!this.isMesh(a)) left.delete();
      if (!this.isMesh(b)) right.delete();
    }
  }

  /**
   * Splits a mesh body along a plane in two (P3-08's Split Body on a mesh
   * body, P4-06 ADR-0066 §4): the part along `normal` and the part on the
   * other side, straight from manifold-3d. `offset` is the plane's distance
   * from the origin along `normal`, so the plane is `x · normal = offset`.
   * A side with nothing in it comes back as `null` (manifold's own empty
   * manifold is not a body). A solid body has no such call: the feature cuts
   * it with a half-space box (ADR-0053).
   */
  splitByPlane(
    shape: ShapeHandle,
    normal: Vec3,
    offset: number,
  ): [ShapeHandle | null, ShapeHandle | null] {
    if (!this.isMesh(shape)) {
      throw new KernelError('Only a mesh body is split by a plane this way.');
    }
    const [along, against] = this.#manifoldOf(shape).splitByPlane(normal, offset);
    return [
      along.isEmpty() ? (along.delete(), null) : this.#meshHandle(along),
      against.isEmpty() ? (against.delete(), null) : this.#meshHandle(against),
    ];
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
    if (this.isMesh(shape)) {
      // manifold-3d's own transform: no history, since there are no B-rep
      // sub-shapes to carry names through. It keeps the triangles facing out
      // under a reflection (measured, ADR-0066 §4), and `#outward` is the net
      // in case a future version doesn't.
      const moved = this.#manifoldOf(shape).transform(mat4Of(matrix));
      return { shape: this.#meshHandle(this.#outward(moved)), history: [] };
    }
    const f = this.#facade;
    f.clearNumbers();
    for (const value of matrix) f.pushNumber(value);
    return this.#withHistory(f.transform(shape));
  }

  /**
   * Scales a shape about `centre` by `factors` along the world X, Y and Z
   * axes (P3-08), each greater than 0. Equal factors keep every surface's
   * type; different ones make curved faces B-splines (a cylinder scaled
   * across its axis has an elliptic section) while flat faces stay planes
   * and the straight edges between them lines. History (input 0): every
   * face, edge and vertex is `modified` into its image.
   */
  scale(shape: ShapeHandle, centre: Vec3, factors: Vec3): OperationResult {
    // A mesh body has no B-rep surfaces to rebuild, so the same 3 × 4 matrix
    // Move and Mirror use does the job (P4-06, ADR-0066 §4). Its factors are
    // all greater than 0, which the feature checks, so the matrix is never a
    // reflection.
    if (this.isMesh(shape)) {
      const [fx, fy, fz] = factors;
      const matrix = [
        fx,
        0,
        0,
        centre[0] * (1 - fx),
        0,
        fy,
        0,
        centre[1] * (1 - fy),
        0,
        0,
        fz,
        centre[2] * (1 - fz),
      ];
      return this.transform(shape, matrix);
    }
    const f = this.#facade;
    f.clearNumbers();
    for (const value of [...centre, ...factors]) f.pushNumber(value);
    return this.#withHistory(f.scale(shape));
  }

  /**
   * Tilts faces of a solid (P3-08, draft): each of `faces` (indices into the
   * shape's face list) turns by `angle` radians about the line where it
   * meets the neutral plane (through `plane.origin`, normal `plane.normal`,
   * the pull direction). Positive removes matter on the pull side, so the
   * body narrows along the pull. Only flat, cylindrical and conical faces
   * tilt; faces that run smoothly into a picked one tilt with it. A failure
   * is a `DraftError` with the facade's diagnosis. History (input 0): every
   * sub-shape is `modified` into its image.
   */
  draft(
    shape: ShapeHandle,
    faces: readonly number[],
    plane: { origin: Vec3; normal: Vec3 },
    angle: number,
  ): OperationResult {
    this.#solid(shape, 'Draft');
    const f = this.#facade;
    f.clearArgs();
    for (const face of faces) f.pushArg(face);
    const handle = f.draft(shape, ...plane.origin, ...plane.normal, angle);
    if (handle === 0) {
      throw new DraftError(
        f.lastError() || 'The draft failed.',
        decodeDraftProblems(this.#copy(Float64Array, f.geometryPtr(), f.geometrySize())),
      );
    }
    return this.#withHistory(handle);
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
    this.#solid(shape, 'Extrude');
    return this.#withHistory(this.#facade.prism(shape, ...shift, ...vector, taper));
  }

  /**
   * The smallest distance between two shapes in mm: 0 where they touch,
   * overlap or one lies inside a solid of the other.
   */
  distance(a: ShapeHandle, b: ShapeHandle): number {
    this.#solid(a, 'Measure');
    this.#solid(b, 'Measure');
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

  /**
   * New handles to each solid of a shape (a compound of solids from a boolean
   * or a sweep). A mesh body's are its connected pieces (`decompose()`), which
   * is how an STL of several parts becomes one body each.
   */
  solids(shape: ShapeHandle): ShapeHandle[] {
    if (this.isMesh(shape)) {
      const out: ShapeHandle[] = [];
      try {
        for (const piece of this.#manifoldOf(shape).decompose()) out.push(this.#meshHandle(piece));
      } catch (error) {
        this.release(...out);
        throw error;
      }
      return out;
    }
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
    this.#solid(shape, 'Revolve');
    const { origin: o, direction: d } = axis;
    return this.#withHistory(this.#facade.revolve(shape, ...o, ...d, angle));
  }

  /**
   * A path (P4-01): the pieces chained end to end into one wire, starting
   * with the first piece in its own direction; ends within `tolerance` mm are
   * one point. Sketch curves stay exact. Pieces that don't make one chain (a
   * gap, a branch) fail with a `PathError`.
   */
  path(pieces: readonly PathPiece[], tolerance = 1e-3): ShapeHandle {
    const f = this.#facade;
    f.pathClear();
    for (const piece of pieces) {
      if (piece.kind === 'edge') {
        this.#solid(piece.shape, 'Sweep');
        this.#check(f.pathEdge(piece.shape, piece.edge));
        continue;
      }
      f.sketchClear();
      if (this.#stageCurve(piece.curve) < 0) {
        throw new KernelError(f.lastError() || "A curve of the path couldn't be made.");
      }
      const { origin: o, x, normal: n } = piece.frame;
      this.#check(f.pathSketch(...o, ...x, ...n));
    }
    const handle = f.pathWire(tolerance);
    if (handle === 0) {
      const v = this.#copy(Float64Array, f.geometryPtr(), f.geometrySize());
      throw new PathError(f.lastError() || "The path couldn't be made.", v[0] ?? 0);
    }
    return handle as ShapeHandle;
  }

  /** A helix as a one-edge wire (P4-01): a coil's path. */
  helix(options: HelixOptions): ShapeHandle {
    const { origin, axis, start, radius, pitch, turns } = options;
    return this.#check(
      this.#facade.helix(
        ...origin,
        ...axis,
        ...start,
        radius,
        pitch,
        turns,
        options.taper ?? 0,
        options.left ?? false,
      ),
    );
  }

  /**
   * Sweeps a profile (a face or a compound of faces, holes and all) along a
   * path wire (P4-01, `path`, `helix`). The profile stays where it is and
   * travels with the path's frame from the path's end nearer to it. A failure
   * is a `SweepError`. History (input 0, the profile): `first` and `last`
   * (each face's caps), `generated` (each edge's side faces).
   */
  sweep(profile: ShapeHandle, path: ShapeHandle, options: SweepOptions = {}): OperationResult {
    this.#solid(profile, 'Sweep');
    this.#solid(path, 'Sweep');
    const f = this.#facade;
    const orientation = options.orientation ?? 'follow';
    const mode = orientation === 'follow' ? 0 : orientation === 'fixed' ? 1 : 2;
    const direction: Vec3 = typeof orientation === 'object' ? orientation.binormal : [0, 0, 1];
    const handle = f.sweep(
      profile,
      path,
      mode,
      options.twist ?? 0,
      options.scale ?? 1,
      options.verify ?? true,
      ...direction,
    );
    if (handle === 0) {
      const status = this.#copy(Float64Array, f.geometryPtr(), f.geometrySize())[0];
      const problem: SweepProblem =
        status === 2
          ? { kind: 'crosses' }
          : status === 3
            ? { kind: 'twist-corner' }
            : status === 4
              ? { kind: 'closed-scale' }
              : { kind: 'failed' };
      throw new SweepError(f.lastError() || 'The sweep failed.', problem);
    }
    return this.#withHistory(handle);
  }

  /**
   * Lofts through sections in order (P4-01): shapes holding one face without
   * holes, or points (first or last only). `ruled` joins neighbours straight;
   * `closed` joins the last back to the first (a ring, at least three
   * sections, no points). A failure is a `LoftError`. History: input i is
   * section i; `first` (the first section's face → the start cap), `last`
   * (the last's → the end cap), `generated` (every section edge's side faces).
   */
  loft(
    sections: readonly LoftSection[],
    options: { ruled?: boolean; closed?: boolean } = {},
  ): OperationResult {
    for (const section of sections) {
      if (isShapeSection(section)) this.#solid(section, 'Loft');
    }
    const f = this.#facade;
    f.clearArgs();
    f.clearNumbers();
    for (const section of sections) {
      if (typeof section === 'number') {
        f.pushArg(section);
        continue;
      }
      f.pushArg(0);
      for (const value of section.point) f.pushNumber(value);
    }
    const handle = f.loft(options.ruled ?? false, options.closed ?? false);
    if (handle === 0) {
      const v = this.#copy(Float64Array, f.geometryPtr(), f.geometrySize());
      const section = v[1] ?? 0;
      const problem: LoftProblem =
        v[0] === 2
          ? { kind: 'crosses' }
          : v[0] === 3
            ? { kind: 'holes', section }
            : v[0] === 5
              ? { kind: 'not-one-face', section }
              : v[0] === 6
                ? { kind: 'point-inside', section }
                : { kind: 'failed' };
      throw new LoftError(f.lastError() || 'The loft failed.', problem);
    }
    return this.#withHistory(handle);
  }

  /**
   * The helical sweep of a modeled thread (P4-02, ADR-0056): a flat
   * `profile` face in a plane through `axis`, on one side of it and shorter
   * along it than `pitch`, carried round the axis as a screw moves: `pitch`
   * mm per turn for `turns` turns, right-handed (counter-clockwise seen
   * from the axis's tip as it rises) unless `left`. History as for `prism`
   * (one side face per profile edge and turn).
   */
  threadSweep(
    profile: ShapeHandle,
    axis: Axis,
    pitch: number,
    turns: number,
    left: boolean,
  ): OperationResult {
    this.#solid(profile, 'Thread');
    const { origin: o, direction: d } = axis;
    return this.#withHistory(this.#facade.threadSweep(profile, ...o, ...d, pitch, turns, left));
  }

  /**
   * What a thread needs of cylindrical face `face` of `shape` (P4-02), or
   * undefined when it isn't a cylinder: see `ThreadFace`.
   */
  threadFace(shape: ShapeHandle, face: number, operation = 'Thread'): ThreadFace | undefined {
    // `operation` names the feature in a mesh refusal: Emboss asks for the same
    // geometry and says "Emboss", not "Thread" (ADR-0066 §4).
    this.#solid(shape, operation);
    const f = this.#facade;
    if (f.threadFace(shape, face) < 0) return undefined;
    const v = this.#copy(Float64Array, f.geometryPtr(), f.geometrySize());
    const at = (k: number) => v[k] as number;
    return {
      axis: { origin: [at(0), at(1), at(2)], direction: [at(3), at(4), at(5)] },
      radius: at(6),
      inside: at(7) === 1,
      from: at(8),
      to: at(9),
      whole: at(10) === 1,
      open: [at(11) === 1, at(12) === 1],
    };
  }

  /**
   * Wraps the planar profile `face` around a cylinder and returns the solid
   * between radius `frame.radius` and `frame.radius` + `depth` (outward) or
   * `frame.radius` - `depth` (inward) (P4-04, ADR-0060 §3): the letters of an
   * emboss stand out of a round face instead of being projected on it.
   *
   * `face` has to be a single flat face, and its plane has to run along the
   * cylinder's axis, with `frame.corner` in it. Every curve is mapped exactly
   * into the cylinder's parameters (a line to a line, a circle to an ellipse,
   * a B-spline pole by pole), so both caps are exact surfaces and the walls
   * between them are exactly radial. A failure is a `KernelError` with the
   * facade's message (a depth at or past the radius, an outline that doesn't
   * close up, profiles more than half way round).
   *
   * History (input 0, the profile face): `first` and `last` (the two caps, on
   * `radius` and on `radius` ± depth) and `generated` (each edge's wall).
   */
  wrapOnCylinder(
    face: ShapeHandle,
    frame: WrapFrame,
    depth: number,
    outward = true,
  ): OperationResult {
    this.#solid(face, 'Emboss');
    const f = this.#facade;
    const handle = f.wrapOnCylinder(
      face,
      ...frame.origin,
      ...frame.axis,
      ...frame.reference,
      frame.radius,
      ...frame.corner,
      ...frame.across,
      depth,
      outward,
    );
    if (handle === 0) throw new KernelError(f.lastError() || 'The wrap failed.');
    return this.#withHistory(handle);
  }

  /** A compound holding the shapes (which stay valid; release them separately). */
  compound(shapes: readonly ShapeHandle[]): ShapeHandle {
    for (const shape of shapes) this.#solid(shape, 'Combine');
    this.#facade.clearArgs();
    for (const shape of shapes) this.#facade.pushArg(shape);
    return this.#check(this.#facade.compound());
  }

  /** A new handle to one face, edge or vertex of a shape (by sub-shape index). */
  subShape(shape: ShapeHandle, kind: SubShapeKind, index: number): ShapeHandle {
    this.#solid(shape, 'Sketch on face');
    return this.#check(this.#facade.subShape(shape, KIND_CODE[kind], index));
  }

  /**
   * Where the sub-shapes of one kind of `part` sit in `whole`: for each, in
   * part's order, its index in whole, or -1 where it isn't part of whole.
   * (A face of a body: which body edges bound it.)
   */
  locate(part: ShapeHandle, whole: ShapeHandle, kind: SubShapeKind): number[] {
    this.#solid(part, 'Split Body');
    this.#solid(whole, 'Split Body');
    const f = this.#facade;
    if (f.locate(part, whole, KIND_CODE[kind]) < 0) throw new KernelError('Unknown shape.');
    return Array.from(this.#copy(Int32Array, f.lookupPtr(), f.lookupSize()));
  }

  /**
   * Geometry and adjacency of every face, edge and vertex (topological naming,
   * fingerprints). A mesh body has the one face of all its triangles and no
   * edges or vertices: its creases are display edges, not B-rep ones.
   */
  describe(shape: ShapeHandle): ShapeDescription {
    if (this.isMesh(shape)) {
      const box = this.#boxOf(shape);
      return {
        faces: [
          {
            type: 'other',
            area: this.#manifoldOf(shape).surfaceArea(),
            centroid: [
              (box.min[0] + box.max[0]) / 2,
              (box.min[1] + box.max[1]) / 2,
              (box.min[2] + box.max[2]) / 2,
            ],
          },
        ],
        edges: [],
        vertices: [],
      };
    }
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
    this.#solid(shape, 'Project');
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
    this.#solid(shape, 'Sketch on face');
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
    // A mesh body is one face and no edges or vertices (ADR-0066 §3).
    if (this.isMesh(shape)) return kind === 'face' ? 1 : 0;
    const n = this.#facade.count(shape, KIND_CODE[kind]);
    if (n < 0) throw new KernelError('Unknown shape.');
    return n;
  }

  isValid(shape: ShapeHandle): boolean {
    if (this.isMesh(shape)) return this.#manifoldOf(shape).status() === 'NoError';
    return this.#facade.isValid(shape);
  }

  measure(shape: ShapeHandle): Measurements {
    if (this.isMesh(shape)) {
      const manifold = this.#manifoldOf(shape);
      const box = manifold.boundingBox();
      return {
        volume: manifold.volume(),
        area: manifold.surfaceArea(),
        bbox: {
          min: [box.min[0], box.min[1], box.min[2]],
          max: [box.max[0], box.max[1], box.max[2]],
        },
      };
    }
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
    if (this.isMesh(shape)) {
      // manifold-3d has no centre of mass, so a mesh body's is the centre of
      // its box (ADR-0066's Results says so).
      const { volume, area, bbox } = this.measure(shape);
      return {
        volume,
        area,
        length: 0,
        centroid: [
          (bbox.min[0] + bbox.max[0]) / 2,
          (bbox.min[1] + bbox.max[1]) / 2,
          (bbox.min[2] + bbox.max[2]) / 2,
        ],
        bbox,
      };
    }
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
    this.#solid(shape, 'Construction geometry');
    const f = this.#facade;
    if (!f.surfaceGeometry(shape, face)) throw new KernelError(f.lastError() || 'Unknown face.');
    return decodeSurfaceGeometry(this.#copy(Float64Array, f.geometryPtr(), f.geometrySize()));
  }

  /**
   * Tessellates a shape for the view. A mesh body meshes to itself: one face
   * of all its triangles, normals flat across a crease (30°) and smooth
   * elsewhere, and its creases as edges (`EDGE_MESH`).
   */
  mesh(shape: ShapeHandle, options: MeshOptions): BodyMesh {
    if (this.isMesh(shape)) return displayMesh(this.#trianglesOf(shape));
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
    // A mesh body exports its own triangles: nothing to tessellate.
    if (this.isMesh(shape)) return this.#trianglesOf(shape);
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
   * (P2-12). The text is ASCII. A mesh body is refused: STEP holds exact
   * B-rep geometry (ADR-0066 §3).
   */
  writeStep(parts: readonly { shape: ShapeHandle; name: string }[]): string {
    for (const { shape } of parts) this.#solid(shape, 'A STEP file');
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
    for (const shape of shapes) {
      const manifold = this.#meshes.get(shape);
      if (manifold === undefined) continue;
      this.#meshes.delete(shape);
      manifold.delete();
    }
    for (const shape of shapes) {
      if (!this.isMesh(shape)) this.#facade.release(shape);
    }
  }

  /** Tracks handles and releases them all when the scope is disposed (`using`). */
  scope(): ShapeScope {
    return new ShapeScope(this);
  }

  stats(): KernelStats {
    // A leaked mesh counts as a leaked shape, so strict leaks catches it.
    const heap = this.heap();
    return {
      liveShapes: this.#facade.liveShapes() + this.#meshes.size,
      heapTop: heap.top,
      heapBytes: heap.size,
    };
  }

  /**
   * How much of the WASM heap is in use (P4-12 H4): the top of its malloc heap
   * and the size of the WASM memory. Both are free to read.
   */
  heap(): HeapUsage {
    return { top: this.#facade.heapTop(), size: this.#oc.wasmMemory.buffer.byteLength };
  }

  /** Aborts the WASM instance on purpose. Only for the crash-recovery test. */
  debugAbort(): never {
    this.#facade.debugAbort();
    throw new Error('debugAbort returned');
  }

  /** Frees every shape and the facade itself. The kernel is unusable afterwards. */
  dispose(): void {
    this.release(...([...this.#meshes.keys()] as ShapeHandle[]));
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

  /** The mesh a handle stands for, or the mesh refusal a user should see. */
  #manifoldOf(shape: ShapeHandle): Manifold {
    const manifold = this.#meshes.get(shape);
    if (!manifold) {
      throw new MeshBodyError('This body is a mesh, and it is no longer in the model. Try again.');
    }
    return manifold;
  }

  /**
   * The manifold of a body for a boolean or a gap: the mesh body's own, or a
   * temporary manifold made of the solid meshed at `MESH_BOOLEAN_DEFLECTION`.
   * The caller frees what `#meshOwned` says is temporary.
   */
  #manifoldFor(shape: ShapeHandle): Manifold {
    if (this.isMesh(shape)) return this.#manifoldOf(shape);
    const module = this.#manifold;
    if (!module) {
      throw new KernelError(
        "A boolean with a mesh body needs the mesh kernel, which isn't loaded (the document has no mesh import).",
      );
    }
    const mesh = this.exportMesh(shape, MESH_BOOLEAN_DEFLECTION);
    // A `Mesh` is a value manifold-3d copies out of, not a handle: the
    // manifold owns what it needs afterwards.
    const gl = new module.Mesh({
      numProp: 3,
      vertProperties: Float32Array.from(mesh.positions),
      triVerts: mesh.indices,
    });
    gl.merge();
    return new module.Manifold(gl);
  }

  /**
   * A boolean between a mesh body and anything else (P4-06, ADR-0066 §4): both
   * operands go to manifold-3d, the B-rep one meshed at
   * `MESH_BOOLEAN_DEFLECTION`, and the result is a mesh body.
   */
  #meshBoolean(op: keyof typeof BOOLEAN_CODE, target: ShapeHandle, tool: ShapeHandle): ShapeHandle {
    const module = this.#manifold;
    if (!module) {
      throw new KernelError(
        "A boolean with a mesh body needs the mesh kernel, which isn't loaded (the document has no mesh import).",
      );
    }
    const left = this.#manifoldFor(target);
    const right = this.#manifoldFor(tool);
    let result: Manifold;
    try {
      result =
        op === 'fuse'
          ? module.Manifold.union(left, right)
          : op === 'cut'
            ? module.Manifold.difference(left, right)
            : module.Manifold.intersection(left, right);
    } catch (error) {
      // The `finally` frees the temporaries; a second `delete()` on the same
      // manifold would be a double free inside the WASM heap.
      throw new KernelError(
        `The boolean failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // The operands the bodies own stay; the ones built here go.
      if (!this.isMesh(target)) left.delete();
      if (!this.isMesh(tool)) right.delete();
    }
    if (result.status() !== 'NoError') {
      const status = result.status();
      result.delete();
      throw new KernelError(`The boolean failed (${status}).`);
    }
    return this.#meshHandle(result);
  }

  /**
   * The triangles of a manifold facing outwards: manifold-3d keeps them so
   * under a reflection (ADR-0066 §4 measures it), and this turns them the
   * other way if one day it doesn't, since a solid whose faces point inwards
   * has a negative volume and every boolean of it is nonsense.
   */
  #outward(manifold: Manifold): Manifold {
    const module = this.#manifold;
    if (!module || manifold.volume() >= 0) return manifold;
    const gl = manifold.getMesh();
    const indices = gl.triVerts;
    const reversed = new Uint32Array(indices.length);
    for (let t = 0; t < indices.length; t += 3) {
      reversed[t] = indices[t] as number;
      reversed[t + 1] = indices[t + 2] as number;
      reversed[t + 2] = indices[t + 1] as number;
    }
    const mesh = new module.Mesh({
      numProp: 3,
      vertProperties: Float32Array.from(gl.vertProperties),
      triVerts: reversed,
    });
    mesh.merge();
    const fixed = new module.Manifold(mesh);
    manifold.delete();
    return fixed;
  }

  /** The triangles of a mesh body: the export mesh form, which is the same mesh. */
  #trianglesOf(shape: ShapeHandle): ExportMesh {
    const gl = this.#manifoldOf(shape).getMesh();
    return {
      positions: Float64Array.from(gl.vertProperties),
      indices: Uint32Array.from(gl.triVerts),
    };
  }

  /** Keeps a manifold as a body, with a handle of its own. */
  #meshHandle(manifold: Manifold): ShapeHandle {
    const handle = this.#nextMesh++ as ShapeHandle;
    this.#meshes.set(handle, manifold);
    return handle;
  }

  /** The box of a mesh body, in world mm. */
  #boxOf(shape: ShapeHandle) {
    const box = this.#manifoldOf(shape).boundingBox();
    return { min: [...box.min] as Vec3, max: [...box.max] as Vec3 };
  }

  /** Throws for a mesh body where the operation needs B-rep geometry. */
  #solid(shape: ShapeHandle, operation: string): void {
    if (this.isMesh(shape)) throw new MeshBodyError(meshBodyMessage(operation));
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

/** Whether a loft section is a shape rather than a point (`LoftSection`). */
function isShapeSection(section: LoftSection): section is ShapeHandle {
  return typeof section === 'number';
}

/** What is wrong with a mesh, in the words a user sees (ADR-0066 §3). */
function meshNotSolid(problem: MeshProblem): string {
  const parts: string[] = [];
  if (problem.openEdges > 0) parts.push(`${problem.openEdges} open edges`);
  if (problem.nonManifoldEdges > 0)
    parts.push(`${problem.nonManifoldEdges} edges used by more than two triangles`);
  if (problem.misorientedEdges > 0)
    parts.push(`${problem.misorientedEdges} triangles facing the wrong way`);
  if (problem.badTriangles > 0)
    parts.push(`${problem.badTriangles} faces of fewer than three corners`);
  if (problem.badNodes > 0) parts.push(`${problem.badNodes} points that aren't numbers`);
  // Closed and consistent with every edge used twice, but inside-out: the
  // volume it encloses is negative.
  if (parts.length === 0 && problem.volume <= 0) return 'its triangles face inwards';
  return parts.length > 0 ? parts.join(', ') : "it isn't a closed solid";
}

/**
 * A `Kernel.transform` matrix (three rows of a 3 × 3, each followed by its
 * translation) as manifold-3d's column-major `Mat4`; its last row is ignored.
 */
function mat4Of(matrix: readonly number[]): Mat4 {
  const at = (row: number, col: number) => matrix[4 * row + col] as number;
  return [
    at(0, 0),
    at(1, 0),
    at(2, 0),
    0,
    at(0, 1),
    at(1, 1),
    at(2, 1),
    0,
    at(0, 2),
    at(1, 2),
    at(2, 2),
    0,
    at(0, 3),
    at(1, 3),
    at(2, 3),
    1,
  ] as unknown as Mat4;
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

/** Decodes the facade's shell diagnosis: [status, value]. */
export function decodeShellProblems(v: Float64Array): ShellProblem[] {
  if (v.length < 2) return [{ kind: 'other' }];
  const value = v[1] as number;
  switch (v[0]) {
    case 1:
      return [{ kind: 'too-thick', max: value }];
    case 2:
      return [{ kind: 'unshellable' }];
    case 3:
      return [{ kind: 'all-faces' }];
    case 4:
      return [{ kind: 'not-solid' }];
    case 6:
      return [{ kind: 'tangent', face: Math.round(value) }];
    default:
      return [{ kind: 'other' }];
  }
}

/** Decodes the facade's offset diagnosis: [status, value]. */
export function decodeOffsetFaceProblems(v: Float64Array): OffsetFaceProblem[] {
  if (v.length < 2) return [{ kind: 'other' }];
  switch (v[0]) {
    case 1:
      return [{ kind: 'too-far', max: v[1] as number }];
    case 2:
      return [{ kind: 'unoffsettable' }];
    case 3:
      return [{ kind: 'not-solid' }];
    case 4:
      return [{ kind: 'void' }];
    case 6:
      return [{ kind: 'sharp-chain' }];
    default:
      return [{ kind: 'other' }];
  }
}

/** Decodes the facade's draft diagnosis: [status, value]. */
export function decodeDraftProblems(v: Float64Array): DraftProblem[] {
  if (v.length < 2) return [{ kind: 'other' }];
  const value = v[1] as number;
  switch (v[0]) {
    case 1:
      return [{ kind: 'too-steep', max: (value * 180) / Math.PI }];
    case 2:
      return [{ kind: 'refused', face: Math.round(value) }];
    case 3:
      return [{ kind: 'surface', face: Math.round(value) }];
    case 4:
      return [{ kind: 'not-solid' }];
    case 6:
      return [{ kind: 'undraftable' }];
    case 7:
      return [{ kind: 'parallel', face: Math.round(value) }];
    default:
      return [{ kind: 'other' }];
  }
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
