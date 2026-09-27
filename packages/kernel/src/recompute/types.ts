import type {
  BodyId,
  ExtrudoDocument,
  Feature,
  FeatureDefinition,
  FeatureId,
  FeatureInputs,
  FeatureStatus,
} from '@extrudo/core';
import type { Kernel, ShapeHandle } from '../kernel';
import type { BodyMesh, MeshOptions } from '../mesh';

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
}

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
  /** The bodies before this feature, in creation order. Don't release them. */
  bodies: ReadonlyMap<BodyId, ShapeHandle>;
  /**
   * The output of a feature this one refers to (through a `ref` input).
   * The engine has checked it exists and succeeded.
   */
  output(feature: FeatureId): FeatureOutput;
  /** A stable body ID for the `n`th body this feature creates. */
  bodyId(n?: number): BodyId;
}

export interface FeatureOutput {
  /**
   * The whole body set after this feature (features with `write` access):
   * bodies passed on unchanged keep their handles. The cache owns new ones.
   */
  bodies?: ReadonlyMap<BodyId, ShapeHandle>;
  /** Other shapes later features use (a sketch's profile faces), by name. The cache owns them. */
  shapes?: Readonly<Record<string, ShapeHandle>>;
  /** Plain data for later features (plane frames, region IDs). Must be JSON-like. */
  data?: unknown;
  /** Turns the status to `warning`. */
  warnings?: readonly string[];
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
      stats: RecomputeStats;
    }
  /** A newer request came in; this one stopped between two features. */
  | { status: 'cancelled' };

/** Called with each feature just before it is evaluated (not for cache hits). */
export type ProgressListener = (feature: FeatureId) => void;
