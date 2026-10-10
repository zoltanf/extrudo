import type {
  AttachmentId,
  BodyId,
  ExtrudoDocument,
  Feature,
  FeatureDefinition,
  FeatureId,
  FeatureInputs,
  FeatureStatus,
  GeomRef,
  JointId,
  JointReport,
} from '@extrudo/core';
import type { ScadCompiler } from '@extrudo/openscad';
import { type Kernel, KernelError, type ShapeHandle } from '../kernel';
import type { BodyMesh, MeshOptions } from '../mesh';
import type { ShapeDescription } from '../naming/description';
import type { TopoNames } from '../naming/names';
import type { ResolvedRef, ResolveOptions } from '../naming/resolve';
import type { ScriptHost } from '../script-host';

/**
 * A file of the design that the worker doesn't have (P4-06, ADR-0066 §0): the
 * design names it but its bytes never arrived (an attachment record without
 * its file, or a file the app couldn't read). A `KernelError`, so the engine
 * makes it the feature's error and not an internal one.
 */
export class MissingFileError extends KernelError {
  override readonly name = 'MissingFileError';
  // A field and not a constructor parameter, so Node can run this package's
  // TypeScript as it is (P5-03's CLI loads the kernel through it).
  readonly id: AttachmentId;
  constructor(id: AttachmentId, fileName: string) {
    super(`The file ${fileName} is missing from this design.`);
    this.id = id;
  }
}

/** A file the worker holds for the session (`KernelApi.addFile`). */
export interface ImportedFile {
  bytes: Uint8Array;
  /** As the document's attachment record has it (`model/step`, `model/stl`…). */
  mediaType: string;
  /**
   * What the file is called ("bracket.stl"), for a message about it. The app
   * sends it with the bytes, because a file a dialog previews is not in the
   * document yet; the document's own record is the fallback.
   */
  fileName?: string;
}

/**
 * How a feature uses the bodies made before it. It decides what the
 * feature's cache key includes and whether its result replaces the body set.
 *
 * - `none`: doesn't look at bodies (a sketch on an origin plane).
 * - `read`: looks, doesn't change them (a sketch on a face).
 * - `write`: changes the body set (extrude, fillet, a boolean).
 */
export type BodyAccess = 'none' | 'read' | 'write';

/**
 * A feature definition as the kernel sees it: core's data part plus the
 * evaluator (architecture §4.2). One per feature type, in a
 * `FeatureRegistry<KernelFeatureDefinition>`.
 */
export interface KernelFeatureDefinition<I extends FeatureInputs = FeatureInputs>
  extends FeatureDefinition<I> {
  /** Defaults to `write`. */
  bodyAccess?(inputs: I): BodyAccess;
  /**
   * Builds the feature's result. Synchronous: the engine yields to the event
   * loop between features, not inside one. Throw `KernelError` with a
   * message for the user when the feature can't be built; release every
   * shape you don't return (use `kernel.scope()` and `keep`).
   */
  evaluate(ctx: EvalContext<I>): FeatureOutput;
  /**
   * A feature that **makes features** instead of a result (P5-02's Script,
   * ADR-0070 §1): the engine calls this instead of `evaluate` and evaluates
   * what it returns right after it, in order, each under its own cache key, as
   * if they stood in the timeline there. The generated features' IDs must start
   * with this feature's ID and `.` (`<id>.f3`). Throw `KernelError` (a
   * `ScriptRunError` with its line) when nothing can be made.
   */
  expand?(ctx: ExpandContext<I>): Expansion;
  /**
   * Work outside the kernel's thread before evaluation (ADR-0071 §3).
   * Awaited on a cache miss for stored and generated features; no shapes.
   * Evaluation reads the result as `ctx.prepared`, or reports a thrown error.
   */
  prepare?(ctx: PrepareContext<I>): Promise<unknown>;
}

/** What `expand` is given. */
export interface ExpandContext<I extends FeatureInputs = FeatureInputs> {
  feature: Feature;
  inputs: I;
  /** The document as it is before this feature: the features before it, every parameter. */
  doc: ExtrudoDocument;
  /** Every parameter's value by name (mm, degrees, plain), of the whole document. */
  params: Readonly<Record<string, number>>;
  /** The script runner, when the kernel has one (`KernelApi.enableScripts`). */
  scripts: ScriptHost | undefined;
  /**
   * What a plugin feature reads besides (P6-03, ADR-0077 §3): its expression
   * inputs' values, the design's files (its plugin file), and its references
   * resolved among the bodies before it — a guess warns, a reference that
   * can't be found throws `LostReferenceError`, so Fix References offers it.
   */
  value(input: string): number;
  file(id: AttachmentId): Uint8Array;
  fileType(id: AttachmentId): string;
  fileName(id: AttachmentId): string;
  resolve(ref: GeomRef, options?: ResolveOptions): ResolvedRef;
  /** Adds a warning to the feature's status. */
  warn(message: string): void;
}

/** What `expand` gives back. */
export interface Expansion {
  /** The features to evaluate after this one, in order. */
  features: readonly Feature[];
  /** What the feature printed (a script's `console.log`). */
  log: readonly string[];
}

/** What `prepare` may read: the inputs, their values, the design's files and the compilers. */
export type PrepareContext<I extends FeatureInputs = FeatureInputs> = Pick<
  EvalContext<I>,
  'feature' | 'inputs' | 'value' | 'file' | 'fileType' | 'fileName'
> & {
  /**
   * The OpenSCAD compiler (ADR-0071 §3). A `KernelError` when the worker has
   * none: `KernelApi.enableOpenscad()` was not called for this design.
   */
  openscad(): ScadCompiler;
};

export interface EvalContext<I extends FeatureInputs = FeatureInputs> {
  kernel: Kernel;
  feature: Feature;
  /** The inputs, checked against the definition's schema. */
  inputs: I;
  /**
   * The value of an `expr` input, in mm, degrees or plain units. The engine
   * checks every expression before evaluating, so this doesn't fail for an
   * input that exists.
   */
  value(input: string): number;
  /**
   * The bytes of a file of the design (P4-06, ADR-0066 §0), by its
   * attachment ID: an `import` reads its STEP file with this. A `MissingFileError`
   * when the worker doesn't have it, which is the feature's error.
   */
  file(id: AttachmentId): Uint8Array;
  /** The media type of such a file, to tell a STEP file from a mesh. */
  fileType(id: AttachmentId): string;
  /**
   * The name the design's record gives such a file ("bracket.stl"), for a
   * message about it: an `import` says which file it couldn't read or use.
   */
  fileName(id: AttachmentId): string;
  /** The bodies before this feature, in creation order. Don't release them. */
  bodies: ReadonlyMap<BodyId, ShapeHandle>;
  /**
   * The output of a feature this one refers to (through a `ref` input).
   * The engine has checked it exists and succeeded.
   */
  output(feature: FeatureId): FeatureOutput;
  /** The name of a feature of the document ("Extrude1"), for messages; undefined if there is none. */
  featureName(feature: FeatureId): string | undefined;
  /** A stable body ID for the `n`th body this feature creates. */
  bodyId(n?: number): BodyId;
  /** The naming table of a body before this feature (ADR-0005). */
  names(body: BodyId): TopoNames;
  /** Geometry and adjacency of a shape's sub-shapes (cached for bodies). */
  describe(shape: ShapeHandle): ShapeDescription;
  /**
   * Finds the face, edge or vertex a reference names among the bodies
   * before this feature (`resolveRef`, ADR-0005). A guess (fingerprint, or
   * a split face) adds its warning to the feature's status; a reference
   * that can't be found throws a `KernelError` for the user.
   */
  resolve(ref: GeomRef, options?: ResolveOptions): ResolvedRef;
  /** Adds a warning to the feature's status. */
  warn(message: string): void;
  /** What the definition's `prepare` resolved to (ADR-0071 §3); undefined without one. */
  prepared?: unknown;
}

export interface FeatureOutput {
  /**
   * The whole body set after this feature (features with `write` access):
   * bodies passed on unchanged keep their handles. The cache owns new ones.
   */
  bodies?: ReadonlyMap<BodyId, ShapeHandle>;
  /**
   * Naming tables of the bodies this feature made or changed (ADR-0005),
   * in step with their shapes' sub-shapes (`namedPrism`, `namedBoolean`…).
   * A body passed on unchanged keeps its table. A new shape without one is
   * named by position (`<type>:<feature>:face#n`), which only lasts as long
   * as its geometry does.
   */
  names?: ReadonlyMap<BodyId, TopoNames>;
  /** Other shapes later features use (a sketch's profile faces), by name. The cache owns them. */
  shapes?: Readonly<Record<string, ShapeHandle>>;
  /** Plain data for later features (plane frames, region IDs). Must be JSON-like. */
  data?: unknown;
  /**
   * Plain data for the UI thread (P2-09): the recompute result carries it
   * per feature (`reports`), and the app reads it from the model store (a
   * sketch's `SketchReport`: its frame and projections). JSON-like.
   */
  report?: unknown;
  /** Turns the status to `warning`. */
  warnings?: readonly string[];
  /**
   * The bodies this feature broke off another (P6-05, ADR-0081 §2): a fresh
   * body ID → the body it was cut from, **only for pieces of a body that
   * existed before this feature** (a copy or a body the feature itself made
   * has no origin). `splitSolids` and Split Body fill it; the engine collects
   * it into `RecomputeResult.origins` (a piece stays with its source's
   * component).
   */
  origins?: ReadonlyMap<BodyId, BodyId>;
  /**
   * Shapes a feature dialog's live preview draws over the model (UI spec
   * §3.4, ADR-0027): an extrude's prism, styled by what it does to the
   * bodies. The cache owns them like the other shapes (they may be the same
   * handles as a new body). Only previews mesh them; a recompute ignores them.
   */
  previewTools?: readonly PreviewTool[];
}

/**
 * How a preview tool is drawn: new bodies and joins translucent, cuts red
 * (UI spec §3.4), an intersection violet, and `skip` a faint ghost of what a
 * pattern's skipped instance would have been (P4-12). A `skip` tool is drawn
 * beside whatever else the preview shows, never instead of it.
 */
export type PreviewToolStyle = 'new' | 'join' | 'cut' | 'intersect' | 'skip';

export interface PreviewTool {
  shape: ShapeHandle;
  style: PreviewToolStyle;
  /**
   * The naming table of `shape` (P3-07): patterns and mirrors replay a
   * feature's tool, and name the copies' faces from it.
   */
  names?: TopoNames;
  /**
   * `shape` holds solids that overlap each other (P3-17: a pattern's instances, which a
   * boolean applies one colour class at a time instead of fusing them): it is for drawing,
   * and not a valid argument of a boolean, so replaying it is refused.
   */
  interferes?: boolean;
}

/** A preview tool as a preview result carries it. */
export interface PreviewToolMesh {
  mesh: BodyMesh;
  style: PreviewToolStyle;
}

export interface RecomputeRequest {
  doc: ExtrudoDocument;
  /**
   * Bodies the caller already holds meshes of, by the version it got them
   * with. Results leave out meshes the caller has.
   */
  have?: Readonly<Record<BodyId, string>>;
  /** Features that crashed the kernel before: they are reported as errors, not evaluated again. */
  crashed?: readonly FeatureId[];
  tessellation?: MeshOptions;
}

export interface PreviewRequest extends RecomputeRequest {
  /** The feature being edited in a dialog: a new one or an edited copy. */
  draft: Feature;
  /** Where it goes in the timeline (for an edited feature, its own index). */
  index: number;
  /**
   * Also mesh the bodies before the draft (`base` in the result): what the
   * view shows and picks while a feature is edited, rolled back to it.
   */
  base?: boolean;
}

export interface BodyResult {
  id: BodyId;
  /** Changes whenever the body's shape does; the same for the same shape across kernel restarts. */
  version: string;
  /** Left out when the request's `have` lists this version. */
  mesh?: BodyMesh;
}

export interface RecomputeStats {
  /** Features evaluated (cache misses), in order. Cache hits aren't listed. */
  evaluated: FeatureId[];
  /** Features whose result came from the cache. */
  reused: number;
  ms: number;
  /** Shapes held by the kernel afterwards (the cache and the current bodies). */
  liveShapes: number;
}

export type RecomputeResult =
  | {
      status: 'done';
      /** Status of every active feature, suppressed ones left out. */
      features: Record<FeatureId, FeatureStatus>;
      /** The bodies at the timeline marker, in creation order. */
      bodies: BodyResult[];
      /**
       * Where each body the walk broke off another came from (P6-05,
       * ADR-0081 §2): a piece → the body it came from, at the marker. A plain
       * record; the app reads it to place a new piece in its source's
       * component. Previews carry it too but nothing reads it there.
       */
      origins: Record<BodyId, BodyId>;
      /**
       * What each unsuppressed joint's frames resolved to at the marker
       * (P6-05, ADR-0081 §4). Recomputes only; never cached.
       */
      joints?: Record<JointId, JointReport>;
      /** `FeatureOutput.report` of every feature that computed and has one. */
      reports: Record<FeatureId, unknown>;
      /**
       * Previews only: the draft's `previewTools`, meshed (absent when it
       * has none or failed). Always meshed, never left out like bodies.
       */
      tools?: PreviewToolMesh[];
      /** Previews with `base`: the bodies before the draft (meshes left out as for `bodies`). */
      base?: BodyResult[];
      stats: RecomputeStats;
    }
  /** A newer request came in; this one stopped between two features. */
  | { status: 'cancelled' };

/** Called with each feature just before it is evaluated (not for cache hits). */
export type ProgressListener = (feature: FeatureId) => void;
