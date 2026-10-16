/**
 * Body versions (P6-09, ADR-0088 §2): the last recompute's walk, replayed
 * without evaluating anything. Each time a feature gives a body a new shape,
 * the body gets a new version, made by the feature's `csg` hook from earlier
 * versions (csg) or, where that can't be done, a polyhedron of the shape at
 * that version (mesh). Later features build on a mesh version with CSG again.
 *
 * The rules a version falls back to mesh by: the feature has no hook, the
 * hook gave `null` or left the body out, the feature broke a body into pieces
 * (an origin from it), or the hook threw a `KernelError` (it refers to
 * something it can't find). Nothing here meshes: the file (`file.ts`) meshes
 * only the versions the exported bodies reach.
 */
import type { BodyId, Feature, FeatureId, FeatureInputs, GeomRef } from '@extrudo/core';
import { type Kernel, KernelError, type ShapeHandle, type Vec3 } from '../kernel';
import type { ShapeDescription } from '../naming/description';
import type { ResolvedRef, ResolveOptions } from '../naming/resolve';
import type { FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import type { CsgContext, CsgInput } from './context';
import type { CsgNode, Scalar } from './ir';
import type { InputOf, ScadParameters } from './live';

/**
 * A feature of the last recompute that wrote the body set: what the engine
 * kept of its walk for the export (`RecomputeEngine.exportScad`).
 */
export interface ScadStep {
  feature: Feature;
  definition: KernelFeatureDefinition;
  /** Checked against the schema, as the evaluator had them. */
  inputs: FeatureInputs;
  /** Its expression inputs' values. */
  values: Readonly<Record<string, number>>;
  before: ReadonlyMap<BodyId, ShapeHandle>;
  after: ReadonlyMap<BodyId, ShapeHandle>;
  output: FeatureOutput;
  /** The script that made it (ADR-0070 §1), when a script did. */
  script?: FeatureId;
}

/** What the version walk reads of the engine. */
export interface ScadSource {
  kernel: Kernel;
  steps: readonly ScadStep[];
  /** The bodies at the marker. */
  bodies: ReadonlyMap<BodyId, ShapeHandle>;
  /** Resolves references for `feature` among `bodies`, as the engine's evaluators do. */
  resolver(
    feature: Feature,
    bodies: ReadonlyMap<BodyId, ShapeHandle>,
  ): (ref: GeomRef, options?: ResolveOptions) => ResolvedRef;
  output(feature: FeatureId): FeatureOutput | undefined;
  describe(shape: ShapeHandle): ShapeDescription;
  featureName(feature: FeatureId): string | undefined;
  /** A body's name in the document, when it has one. */
  bodyName?(body: BodyId): string | undefined;
  /**
   * Turns an expression input into what the file writes (`liveScalar`: a
   * parameter's variable or the translated expression); default its value.
   * Not asked for a script's features, which write their values.
   */
  scalar?(input: CsgInput, at: InputOf): Scalar;
  /**
   * The document's parameters, for the parameter block (ADR-0088 §5); none
   * (tests that build a source by hand) writes no block.
   */
  parameters?: ScadParameters;
  /**
   * Segments for a full circle of a radius, from the file's `$fa`/`$fs`
   * (ADR-0088 §7); `writeScad` sets it from the export's tessellation. A hook
   * samples a profile's arcs with `CsgContext.fragments`.
   */
  fragments?(radius: number): number;
}

export type Version =
  | {
      kind: 'csg';
      body: BodyId;
      /** 1-based, per body, in timeline order (unwritten versions count too). */
      n: number;
      node: CsgNode;
      /** The step that made it (its feature names its tools). */
      step: number;
    }
  | {
      kind: 'mesh';
      body: BodyId;
      n: number;
      shape: ShapeHandle;
      /** Why it is a mesh, for the header ("Fillet3: no OpenSCAD equivalent"). */
      reason: string;
      step: number;
    };

/** A tool a hook shared (`CsgContext.tool`). */
export interface Tool {
  node: CsgNode;
  step: number;
  /** Its number among its feature's tools, from 1. */
  n: number;
}

export interface Versions {
  versions: Version[];
  tools: Tool[];
  /** Each body's version at the marker. */
  current: ReadonlyMap<BodyId, number>;
  /** How each step's feature is called in the header (a script's feature with its script). */
  stepNames: string[];
  /**
   * Per step, the inputs its hook read through `ctx.scalar` as an expression
   * (live in the file); every other expression input is held fixed.
   */
  reads: ReadonlySet<string>[];
}

/** A hook referred to a body that isn't there before its feature. */
class Unavailable extends KernelError {}

export function walkVersions(source: ScadSource): Versions {
  const versions: Version[] = [];
  const tools: Tool[] = [];
  const stepNames: string[] = [];
  const reads: Set<string>[] = [];
  const current = new Map<BodyId, number>();
  const counts = new Map<BodyId, number>();
  const nextN = (body: BodyId) => {
    const n = (counts.get(body) ?? 0) + 1;
    counts.set(body, n);
    return n;
  };

  source.steps.forEach((step, at) => {
    const { feature, definition, before, after } = step;
    const scriptName = step.script === undefined ? undefined : source.featureName(step.script);
    const name = scriptName ? `${scriptName} › ${feature.name}` : feature.name;
    stepNames.push(name);
    const read = new Set<string>();
    reads.push(read);
    const changed = [...after].filter(([id, shape]) => before.get(id) !== shape).map(([id]) => id);
    const removed = [...before.keys()].filter((id) => !after.has(id));

    // Pieces of a body that existed before (ADR-0081 §2): OpenSCAD can't pick
    // one piece out of a solid, so the source and its pieces are meshes.
    const split = new Map<BodyId, BodyId>();
    for (const [piece, origin] of step.output.origins ?? []) {
      if (!after.has(piece) || !before.has(origin)) continue;
      split.set(piece, origin);
      if (after.has(origin)) split.set(origin, origin);
    }

    let result: ReadonlyMap<BodyId, CsgNode> | null = null;
    let why = definition.csg
      ? 'these options have no OpenSCAD equivalent'
      : 'no OpenSCAD equivalent';
    if (definition.csg && changed.some((id) => !split.has(id))) {
      const ctx = context(source, step, current, tools, at, changed, removed, read, (reason) => {
        why = reason;
      });
      try {
        result = definition.csg(ctx);
      } catch (error) {
        if (!(error instanceof KernelError)) throw error;
        result = null;
        why =
          error instanceof Unavailable
            ? error.message
            : `couldn't be translated (${error.message})`;
      }
    }

    for (const id of changed) {
      const node = result?.get(id);
      const origin = split.get(id);
      const n = nextN(id);
      if (origin === undefined && node) {
        versions.push({ kind: 'csg', body: id, n, node, step: at });
      } else {
        const reason =
          origin !== undefined ? `${name}: split a body into pieces` : `${name}: ${why}`;
        versions.push({
          kind: 'mesh',
          body: id,
          n,
          shape: after.get(id) as ShapeHandle,
          reason,
          step: at,
        });
      }
      current.set(id, versions.length - 1);
    }
    for (const id of removed) current.delete(id);
  });

  return { versions, tools, current, stepNames, reads };
}

function context(
  source: ScadSource,
  step: ScadStep,
  current: ReadonlyMap<BodyId, number>,
  tools: Tool[],
  at: number,
  changed: readonly BodyId[],
  removed: readonly BodyId[],
  read: Set<string>,
  because: (reason: string) => void,
): CsgContext {
  const { feature, values, before, after } = step;
  const input = (name: string): CsgInput | undefined => {
    const stored = feature.inputs[name];
    const value = values[name];
    if (stored?.kind !== 'expr' || value === undefined) return undefined;
    return { value, expr: stored.expr, unit: stored.unit ?? 'length' };
  };
  const toolBase = tools.length;
  let bounds: { min: Vec3; max: Vec3 } | undefined | null = null;
  return {
    kernel: source.kernel,
    feature,
    inputs: step.inputs,
    input,
    scalar(name) {
      const found = input(name);
      if (!found) throw new Error(`${feature.name} has no expression "${name}".`);
      if (!source.scalar || step.script !== undefined) return found.value;
      const scalar = source.scalar(found, { feature: feature.id, input: name });
      if (typeof scalar !== 'number') read.add(name);
      return scalar;
    },
    value(name) {
      const value = values[name];
      if (value === undefined) throw new Error(`${feature.name} has no expression "${name}".`);
      return value;
    },
    resolve: source.resolver(feature, before),
    output(id) {
      const output = source.output(id);
      if (!output) throw new Unavailable(`${source.featureName(id) ?? id} has no result`);
      return output;
    },
    fragments(radius) {
      return source.fragments?.(radius) ?? 5;
    },
    describe: (shape) => source.describe(shape),
    featureName: (id) => source.featureName(id),
    before,
    bodies: before,
    bodyId: (n = 0) => `${feature.id}:${n}` as BodyId,
    after,
    changed,
    removed,
    body(id) {
      const version = current.get(id);
      if (version === undefined || !before.has(id)) {
        throw new Unavailable(`uses a body that isn't there before it`);
      }
      return { kind: 'version', body: id, version };
    },
    bounds() {
      if (bounds !== null) return bounds;
      bounds = undefined;
      for (const shape of before.values()) {
        const { bbox } = source.kernel.measure(shape);
        bounds = bounds
          ? {
              min: bounds.min.map((v, i) => Math.min(v, bbox.min[i] as number)) as unknown as Vec3,
              max: bounds.max.map((v, i) => Math.max(v, bbox.max[i] as number)) as unknown as Vec3,
            }
          : { min: [...bbox.min] as Vec3, max: [...bbox.max] as Vec3 };
      }
      return bounds;
    },
    tool(node) {
      tools.push({ node, step: at, n: tools.length - toolBase + 1 });
      return { kind: 'tool', tool: tools.length - 1 };
    },
    unsupported(reason) {
      because(reason);
      return null;
    },
  };
}
