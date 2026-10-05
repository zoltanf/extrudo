/**
 * What a solid feature does with the tool it made (ADR-0028 §5, shared
 * with revolve, ADR-0029): new bodies, or join, cut and intersect with the
 * bodies it touches or the ones it names. Moved from `extrude.ts`
 * unchanged, but for the feature's words in messages and names.
 *
 * A mesh body takes part in all of it (P4-06, ADR-0066 §4): the boolean itself
 * goes to manifold-3d, the result is a mesh body named `mesh:<feature>`, and a
 * body that becomes a mesh here is told so once.
 *
 * `mergeTools` (a pattern's instances) puts two tools in one group whose boxes
 * overlap when either is **heavy** (P4-12, ADR-0067 §H2), so it never asks
 * OCCT for the distance between two long threads; `touchingBodies`, Combine's
 * join order and a Mirror's copy do ask, and a pair with a mesh in it is asked
 * manifold-3d's `minGap` (`bodiesTouch`) instead.
 */
import type { BodyId, BodyOperation } from '@extrudo/core';
import { type Kernel, KernelError, type ShapeHandle, type ShapeScope } from '../kernel';
import { compareGeometry, deriveNames, type TopoNames } from '../naming/names';
import { type NamedShape, namedBoolean } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, PreviewTool } from '../recompute/types';
import { nameMeshBodies, warnIfBecameMesh } from './mesh-bodies';
import { add, scale } from './vec';

/** Distances (mm) at or below which shapes touch. */
export const TOUCH = 1e-4;

/**
 * How close two bodies have to be when one of them is a mesh (P4-06,
 * ADR-0066 §4). A mesh body's gap comes from manifold-3d's `minGap`, whose
 * answer is capped at the length it searches, so the search is a little longer
 * than the touch distance; nanometres are close enough, since a mesh cut and
 * the body it cuts meet exactly.
 */
export const MESH_TOUCH = 1e-6;
const MESH_GAP_SEARCH = 1e-3;

/**
 * Whether two bodies touch, overlap or lie inside each other (the question a
 * join asks before it fuses and a Mirror asks before it joins a copy to its
 * original). Two solids are OCCT's `distance` at `TOUCH`; a pair with a mesh in
 * it is manifold-3d's `minGap` at `MESH_TOUCH` (ADR-0066 §4).
 */
export function bodiesTouch(ctx: EvalContext, a: ShapeHandle, b: ShapeHandle): boolean {
  const { kernel } = ctx;
  if (!kernel.isMesh(a) && !kernel.isMesh(b)) return kernel.distance(a, b) <= TOUCH;
  return kernel.minGap(a, b, MESH_GAP_SEARCH) <= MESH_TOUCH;
}

/**
 * More faces than this and a tool is **heavy** (P4-12, ADR-0067 §H2). Asking
 * OCCT for the exact distance between a heavy tool and another shape is slow
 * (between the tools of two modelled threads of 36 and 30 turns it measured
 * 277 s in one call), while merging them is cheap and always correct, so heavy
 * tools don't get the exact test. A thread's tool has about four faces a turn
 * (`thread.test.ts` counts them), so 50 turns is heavy.
 */
export const HEAVY_TOOL_FACES = 200;

/** Whether a tool is heavy (`HEAVY_TOOL_FACES`). */
export const isHeavyTool = (kernel: Kernel, shape: ShapeHandle): boolean =>
  kernel.count(shape, 'face') > HEAVY_TOOL_FACES;

/** How a feature speaks of itself in messages and names its boolean faces. */
export interface OperationWords {
  /** The feature's word in messages and the `op` of names: `extrude`, `revolve`. */
  noun: string;
  /** What to check when a cut or intersection misses: "Check its direction and distance." */
  check: string;
}

export interface OperationSettings {
  operation: BodyOperation;
  /** Explicit participants (body IDs); empty means automatic. */
  bodies: string[];
}

/** The bodies named in `bodies`, or undefined for "automatic". */
export function explicitBodies(
  ctx: EvalContext,
  settings: OperationSettings,
  words: OperationWords,
): BodyId[] | undefined {
  if (settings.bodies.length === 0) return undefined;
  const ids = [...new Set(settings.bodies)] as BodyId[];
  const gone = ids.find((id) => !ctx.bodies.has(id));
  if (gone !== undefined) {
    throw new LostReferenceError(
      `One of the bodies to ${verb(settings.operation)} no longer exists. Edit the ${words.noun} and pick the bodies again.`,
      { kind: 'body', id: gone },
    );
  }
  return ids;
}

/**
 * A tool made of many solids that may overlap each other (P3-17: a pattern's
 * instances for a cut). `shape` holds all of them (for drawing and for finding the bodies
 * they touch); `passes` are compounds of solids that don't interfere, each a
 * valid boolean argument, which a join or cut applies one after the other: the
 * result is the same as one boolean with their union, without fusing them
 * first. A tool of one pass is an ordinary tool.
 */
export interface ToolSet extends NamedShape {
  passes: readonly NamedShape[];
  /** More than one pass: `shape` is not a valid boolean argument. */
  interferes: boolean;
}

export function operate(
  ctx: EvalContext,
  scope: ShapeScope,
  settings: OperationSettings,
  tool: NamedShape | ToolSet,
  participants: BodyId[] | undefined,
  warnings: string[],
  words: OperationWords,
): Pick<FeatureOutput, 'bodies' | 'names' | 'previewTools'> {
  const { kernel } = ctx;
  const operation = settings.operation;
  if (operation === 'new-body') return newBodies(ctx, scope, tool, words);

  const targets = participants ?? touchingBodies(ctx, scope, tool.shape);
  const set = 'passes' in tool && tool.interferes ? tool : undefined;
  // Kept only on success: a failure below must release the tool with the scope.
  const preview = (): PreviewTool[] => [
    {
      shape: scope.keep(tool.shape),
      style: operation,
      names: tool.names,
      ...(set && { interferes: true }),
    },
  ];
  const named = (id: BodyId): NamedShape => ({
    shape: ctx.bodies.get(id) as ShapeHandle,
    names: ctx.names(id),
  });
  const options = { feature: ctx.feature.id, op: words.noun };

  if (operation === 'join') {
    const [first, ...rest] = targets;
    if (first === undefined) {
      warnings.push(`Nothing to join to, so the ${words.noun} made a new body.`);
      return { ...newBodies(ctx, scope, tool, words), previewTools: preview() };
    }
    // (A tool set of overlapping instances is only made for cuts: joins fuse them first.)
    if (set) throw new KernelError(`Overlapping instances can't be joined in passes.`);
    let joined = namedBoolean(kernel, 'fuse', named(first), tool, { ...options, simplify: true });
    scope.track(joined.shape);
    for (const id of rest) {
      joined = namedBoolean(kernel, 'fuse', joined, named(id), { ...options, simplify: true });
      scope.track(joined.shape);
    }
    const bodies = new Map(ctx.bodies);
    for (const id of rest) bodies.delete(id);
    bodies.set(first, scope.keep(joined.shape));
    return nameMeshBodies(ctx, {
      bodies,
      names: new Map([[first, joined.names]]),
      previewTools: preview(),
    });
  }

  const op = operation === 'cut' ? 'cut' : 'common';
  if (set && op === 'common') {
    // The intersection with a union isn't a sequence of intersections.
    throw new KernelError(`Overlapping instances can't be intersected. ${words.check}`);
  }
  const changed = new Map<BodyId, NamedShape | undefined>();
  for (const id of targets) {
    const before = named(id);
    let result = before;
    // One boolean per pass, each on what the last left; a pass that removes the body ends it.
    for (const pass of set?.passes ?? [tool]) {
      // Passes simplify (merge faces the next pass split again): the fused tool they stand
      // in for had its faces merged, so the walls of overlapping instances stay whole.
      result = namedBoolean(
        kernel,
        op,
        result,
        pass,
        set ? { ...options, simplify: true } : options,
      );
      scope.track(result.shape);
      if (set && kernel.measure(result.shape).volume <= 0) break;
    }
    // A solid that a mesh has swallowed is a mesh from here on (ADR-0066 §4).
    warnIfBecameMesh(ctx, before.shape, result.shape);
    const was = kernel.measure(before.shape).volume;
    const now = kernel.measure(result.shape).volume;
    const eps = 1e-6 * Math.max(1, Math.abs(was));
    if (op === 'cut' && Math.abs(was - now) <= eps) continue;
    if (now > eps) {
      changed.set(id, result);
    } else if (op === 'cut') {
      changed.set(id, undefined);
      warnings.push('The cut removed a whole body.');
    } else if (participants) {
      throw new KernelError(
        `Nothing is left of one of its bodies after the intersection. Check the ${words.noun}, or pick other bodies.`,
      );
    }
    // An automatic intersect target it only touches stays as it is.
  }
  if (changed.size === 0) {
    if (op === 'cut') {
      throw new KernelError(
        targets.length === 0
          ? `The cut doesn't touch any body. ${words.check}`
          : `The cut doesn't remove anything. ${words.check}`,
      );
    }
    throw new KernelError(
      `The ${words.noun} doesn't overlap any body, so there's nothing to intersect. ${words.check}`,
    );
  }
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  for (const [id, result] of changed) {
    if (!result) {
      bodies.delete(id);
      continue;
    }
    bodies.set(id, scope.keep(result.shape));
    names.set(id, result.names);
  }
  return nameMeshBodies(ctx, { bodies, names, previewTools: preview() });
}

/** A box as `Kernel.measure` gives it (loose: it never cuts into the shape). */
export interface Box {
  min: readonly number[];
  max: readonly number[];
}

/** Whether two boxes meet or lie within `TOUCH` of each other. */
export const boxesTouch = (a: Box, b: Box): boolean =>
  [0, 1, 2].every(
    (k) =>
      (a.min[k] as number) <= (b.max[k] as number) + TOUCH &&
      (b.min[k] as number) <= (a.max[k] as number) + TOUCH,
  );

/**
 * The bodies a tool touches (within `TOUCH`), for an operation with automatic
 * participants. One exact `distance` between a body and the whole tool is slow
 * when the tool is many solids (a pattern's 40 holes: seconds per body), and
 * most pairs are far apart, so: a body whose box doesn't meet the tool's box
 * is out, and the others are asked solid by solid of the tool, boxes first
 * (P3-17). The exact answer is the same.
 *
 * A mesh body has no B-rep distance, so a pair with a mesh in it is asked
 * manifold-3d's `minGap` instead (ADR-0066 §4), within `MESH_TOUCH`.
 */
export function touchingBodies(ctx: EvalContext, scope: ShapeScope, tool: ShapeHandle): BodyId[] {
  const { kernel } = ctx;
  const toolBox = kernel.measure(tool).bbox;
  const near: { id: BodyId; shape: ShapeHandle; box: Box }[] = [];
  for (const [id, shape] of ctx.bodies) {
    const box = kernel.measure(shape).bbox;
    if (boxesTouch(box, toolBox)) near.push({ id, shape, box });
  }
  if (near.length === 0) return [];
  const touches = (a: ShapeHandle, b: ShapeHandle): boolean => bodiesTouch(ctx, a, b);
  const solids = kernel.solids(tool);
  for (const solid of solids) scope.track(solid);
  // One solid (or something that has none): the exact distance to the whole tool.
  if (solids.length < 2) {
    return near.filter(({ shape }) => touches(shape, tool)).map(({ id }) => id);
  }
  const parts = solids.map((shape) => ({ shape, box: kernel.measure(shape).bbox }));
  return near
    .filter(({ shape, box }) =>
      parts.some((part) => boxesTouch(box, part.box) && touches(shape, part.shape)),
    )
    .map(({ id }) => id);
}

/** The tool as new bodies: one per separate solid, in geometric order. */
export function newBodies(
  ctx: EvalContext,
  scope: ShapeScope,
  tool: NamedShape,
  words: OperationWords,
): Pick<FeatureOutput, 'bodies' | 'names'> {
  const { kernel } = ctx;
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  const solids = kernel.solids(tool.shape);
  for (const solid of solids) scope.track(solid);
  if (solids.length === 0) {
    throw new KernelError(`The ${words.noun} made no solid. Check its profiles.`);
  }
  if (solids.length === 1) {
    const id = ctx.bodyId(0);
    bodies.set(id, scope.keep(tool.shape));
    names.set(id, tool.names);
    return { bodies, names };
  }
  const placed = solids.map((solid) => {
    const { min, max } = kernel.measure(solid).bbox;
    return { solid, center: scale(add(min, max), 0.5) };
  });
  placed.sort((a, b) => compareGeometry(a.center, b.center));
  const named = placed.map(({ solid }) => {
    const faces = kernel.locate(solid, tool.shape, 'face').map((at) => tool.names.faces[at] ?? '');
    return { solid, names: deriveNames(faces, kernel.describe(solid)) };
  });
  named.forEach(({ solid, names: table }, i) => {
    const id = ctx.bodyId(i);
    names.set(id, table);
    bodies.set(id, scope.keep(solid));
  });
  return { bodies, names };
}

function verb(operation: BodyOperation): string {
  return operation === 'new-body' ? 'use' : operation;
}
