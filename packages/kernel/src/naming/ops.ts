/**
 * Kernel operations that name their results (ADR-0005): what feature
 * evaluators call instead of the bare `Kernel` methods, so every face,
 * edge and vertex they return carries a persistent name.
 *
 * Every function returns a new shape; the caller owns it (track it in a
 * `ShapeScope`, `keep` what goes into the output).
 */
import type { SubShapeKind } from '../history';
import type { Axis, BooleanOptions, Kernel, OperationResult, ShapeHandle, Vec3 } from '../kernel';
import { nameSweep, namesOf, propagateNames, type SweepRoles, type TopoNames } from './names';

/** A shape and its naming table. */
export interface NamedShape {
  shape: ShapeHandle;
  names: TopoNames;
}

export interface SweepSource {
  /** The face (or compound of faces) to sweep. */
  shape: ShapeHandle;
  /**
   * What each of its edges comes from, by sub-shape index: a sketch
   * profile's `edges` (sketch curve IDs), `faceEdgeSources` for a body's
   * face, `compoundSources` for several profiles at once.
   */
  edgeSources: readonly (string | null | undefined)[];
}

export interface PrismOptions extends SweepSource {
  /** The feature's ID, part of every name. */
  feature: string;
  /** Operation name in the IDs. Default `extrude`. */
  op?: string;
  vector: Vec3;
  /** Move the profile by this before sweeping (symmetric and two-sided extrudes). */
  shift?: Vec3;
  /** Taper of the sides in radians (`Kernel.prism`). Names don't depend on it. */
  taper?: number;
  /** Other roles in the names (`SweepNaming.roles`). */
  roles?: SweepRoles;
}

/**
 * Extrudes a profile: faces `extrude:<feature>:cap:start` (the profile's
 * own place, after `shift`), `…:cap:end`, and `…:side:<source>` for each
 * profile edge; `#n` where names repeat.
 */
export function namedPrism(kernel: Kernel, options: PrismOptions): NamedShape {
  const result = kernel.prism(options.shape, options.vector, options.shift, options.taper);
  return nameSwept(
    kernel,
    result,
    options.op ?? 'extrude',
    options.feature,
    options.edgeSources,
    options.roles,
  );
}

export interface RevolveOptions extends SweepSource {
  feature: string;
  /** Default `revolve`. */
  op?: string;
  axis: Axis;
  /** Radians; |angle| ≥ 2π is a full revolution (no caps). */
  angle: number;
}

/** Revolves a profile; names as for `namedPrism` (a full revolution has no caps). */
export function namedRevolve(kernel: Kernel, options: RevolveOptions): NamedShape {
  const result = kernel.revolve(options.shape, options.axis, options.angle);
  return nameSwept(kernel, result, options.op ?? 'revolve', options.feature, options.edgeSources);
}

function nameSwept(
  kernel: Kernel,
  result: OperationResult,
  op: string,
  feature: string,
  edgeSources: SweepSource['edgeSources'],
  roles?: SweepRoles,
): NamedShape {
  try {
    const names = nameSweep({
      op,
      feature,
      history: result.history,
      edgeSources,
      result: kernel.describe(result.shape),
      ...(roles ? { roles } : {}),
    });
    return { shape: result.shape, names };
  } catch (error) {
    kernel.release(result.shape);
    throw error;
  }
}

export interface NamedBooleanOptions extends BooleanOptions {
  feature: string;
  /** Operation name for faces that have no source (rare). Default `boolean`. */
  op?: string;
}

/**
 * A boolean that carries both inputs' names into the result: faces keep
 * their names, split faces get `#n`, merged faces keep the target's name.
 */
export function namedBoolean(
  kernel: Kernel,
  op: 'fuse' | 'cut' | 'common',
  target: NamedShape,
  tool: NamedShape,
  options: NamedBooleanOptions,
): NamedShape {
  const result = kernel.boolean(op, target.shape, tool.shape, options);
  return withHistory(kernel, result, [target.names, tool.names], {
    op: options.op ?? 'boolean',
    feature: options.feature,
  });
}

/**
 * Names the result of any operation with history (`OperationResult`) from
 * its inputs' names: see `propagateNames`. For fillets and the like, faces
 * an edge generates are `<op>:<feature>:from:(<edge name>)`. Releases the
 * result if naming fails.
 */
export function withHistory(
  kernel: Kernel,
  result: OperationResult,
  inputs: readonly (TopoNames | undefined)[],
  naming: { op: string; feature: string },
): NamedShape {
  try {
    const names = propagateNames({
      ...naming,
      inputs,
      history: result.history,
      result: kernel.describe(result.shape),
    });
    return { shape: result.shape, names };
  } catch (error) {
    kernel.release(result.shape);
    throw error;
  }
}

/**
 * One face of a named body as a sweep source (press-pull): a new handle to
 * the face, and its edges' names as sources, so the sides are
 * `extrude:<feature>:side:(<edge name>)`. Release `shape` when done.
 */
export function faceEdgeSources(kernel: Kernel, body: NamedShape, face: number): SweepSource {
  const shape = kernel.subShape(body.shape, 'face', face);
  try {
    const at = kernel.locate(shape, body.shape, 'edge');
    return { shape, edgeSources: at.map((i) => body.names.edges[i] ?? null) };
  } catch (error) {
    kernel.release(shape);
    throw error;
  }
}

/**
 * Edge sources of a compound of several sources (several profiles swept at
 * once): each of the compound's edges takes its source from the first part
 * that has it.
 */
export function compoundSources(
  kernel: Kernel,
  compound: ShapeHandle,
  parts: readonly SweepSource[],
): (string | null)[] {
  const sources: (string | null)[] = new Array(kernel.count(compound, 'edge')).fill(null);
  for (const part of parts) {
    kernel.locate(part.shape, compound, 'edge').forEach((at, i) => {
      if (at >= 0 && sources[at] === null) sources[at] = part.edgeSources[i] ?? null;
    });
  }
  return sources;
}

/** The index of the sub-shape with this exact name, or -1. */
export function indexOfName(names: TopoNames, kind: SubShapeKind, name: string): number {
  return namesOf(names, kind).indexOf(name);
}
