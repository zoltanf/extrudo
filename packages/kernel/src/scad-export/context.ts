/**
 * What a feature's `csg` hook reads (P6-09, ADR-0088 §3): the feature as the
 * last recompute evaluated it, at its place in the timeline. The hook runs at
 * export time only, never during a recompute, and changes nothing.
 */
import type { BodyId, Feature, FeatureId, FeatureInputs, GeomRef, UnitKind } from '@extrudo/core';
import type { Kernel, ShapeHandle, Vec3 } from '../kernel';
import type { ShapeDescription } from '../naming/description';
import type { ResolvedRef, ResolveOptions } from '../naming/resolve';
import type { FeatureOutput } from '../recompute/types';
import type { CsgNode, Scalar } from './ir';

/** An `expr` input as the hook sees it: what a translator needs (ADR-0088 §6). */
export interface CsgInput {
  /** Its value in mm, degrees or plain units, as the recompute had it. */
  value: number;
  /** The Extrudo expression as stored (`"width / 2"`). */
  expr: string;
  /** What it measures; stored inputs without one are lengths. */
  unit: UnitKind;
}

/**
 * What a hook gives back: the OpenSCAD node of each body the feature made or
 * changed (`CsgContext.changed`), or `null` when these inputs have no
 * OpenSCAD equivalent. A changed body the map leaves out, and every one on
 * `null`, becomes a mesh version (ADR-0088 §2).
 */
export type CsgResult = ReadonlyMap<BodyId, CsgNode> | null;

export interface CsgContext<I extends FeatureInputs = FeatureInputs> {
  /** For reading geometry only (a frame, a box); release what you make. */
  kernel: Kernel;
  feature: Feature;
  /** The inputs, checked against the definition's schema as the recompute had them. */
  inputs: I;
  /** An `expr` input's value, source and unit; undefined if the feature has no such input. */
  input(name: string): CsgInput | undefined;
  /**
   * An `expr` input as the file writes it: an OpenSCAD expression over the
   * parameters when its Extrudo expression translates (ADR-0088 §6), else its
   * value. Throws for an input the feature doesn't have.
   */
  scalar(name: string): Scalar;
  /** An `expr` input's value (mm, degrees or plain), as `EvalContext.value`. */
  value(name: string): number;
  /**
   * How many segments OpenSCAD draws a full circle of `radius` (mm) with,
   * from the same `$fa`/`$fs` the file writes (ADR-0088 §7): a profile's
   * arcs facet exactly as OpenSCAD's own circles and cylinders do.
   */
  fragments(radius: number): number;
  /** Resolves a reference among the bodies before the feature, as its evaluator did. */
  resolve(ref: GeomRef, options?: ResolveOptions): ResolvedRef;
  /** The output of a feature this one refers to (a sketch's profiles and frame). */
  output(feature: FeatureId): FeatureOutput;
  describe(shape: ShapeHandle): ShapeDescription;
  featureName(feature: FeatureId): string | undefined;
  /** The body set before the feature, in creation order. */
  before: ReadonlyMap<BodyId, ShapeHandle>;
  /**
   * The same as `before`, under `EvalContext`'s name, so the evaluators'
   * placement helpers (`centreOf`, `existing`) take either context.
   */
  bodies: ReadonlyMap<BodyId, ShapeHandle>;
  /** The ID of the `n`th body the feature creates, as `EvalContext.bodyId` gave it. */
  bodyId(n?: number): BodyId;
  /** The body set after it. */
  after: ReadonlyMap<BodyId, ShapeHandle>;
  /** Bodies of `after` with a shape `before` didn't have them with (new or changed), in order. */
  changed: readonly BodyId[];
  /** Bodies of `before` that `after` doesn't have. */
  removed: readonly BodyId[];
  /**
   * A body as it was before the feature: the node that refers to its version.
   * Throws when there is no such body before it, which makes every body of
   * the feature a mesh version.
   */
  body(id: BodyId): CsgNode;
  /** The box around every body before the feature (for `through-all`); undefined with none. */
  bounds(): { min: Vec3; max: Vec3 } | undefined;
  /**
   * A tool the feature uses for several bodies (the prism an extrude cuts
   * with): the file writes it once, as `<Feature>_tool()`, when the bodies
   * that are written use it twice or more, and in place otherwise.
   */
  tool(node: CsgNode): CsgNode;
  /** Says why these inputs can't be translated, for the file's header; returns `null`. */
  unsupported(reason: string): null;
}
