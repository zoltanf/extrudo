/**
 * What a solid feature does with the tool it made (ADR-0028 §5, shared
 * with revolve, ADR-0029): new bodies, or join, cut and intersect with the
 * bodies it touches or the ones it names. Moved from `extrude.ts`
 * unchanged, but for the feature's words in messages and names.
 */
import type { BodyId, BodyOperation } from '@extrudo/core';
import { KernelError, type ShapeHandle, type ShapeScope } from '../kernel';
import { compareGeometry, deriveNames, type TopoNames } from '../naming/names';
import { type NamedShape, namedBoolean } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, PreviewTool } from '../recompute/types';
import { add, scale } from './vec';

/** Distances (mm) at or below which shapes touch. */
export const TOUCH = 1e-4;

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

export function operate(
  ctx: EvalContext,
  scope: ShapeScope,
  settings: OperationSettings,
  tool: NamedShape,
  participants: BodyId[] | undefined,
  warnings: string[],
  words: OperationWords,
): Pick<FeatureOutput, 'bodies' | 'names' | 'previewTools'> {
  const { kernel } = ctx;
  const operation = settings.operation;
  if (operation === 'new-body') return newBodies(ctx, scope, tool, words);

  const targets = participants ?? touchingBodies(ctx, scope, tool.shape);
  // Kept only on success: a failure below must release the tool with the scope.
  const preview = (): PreviewTool[] => [
    { shape: scope.keep(tool.shape), style: operation, names: tool.names },
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
    let joined = namedBoolean(kernel, 'fuse', named(first), tool, { ...options, simplify: true });
    scope.track(joined.shape);
    for (const id of rest) {
      joined = namedBoolean(kernel, 'fuse', joined, named(id), { ...options, simplify: true });
      scope.track(joined.shape);
    }
    const bodies = new Map(ctx.bodies);
    for (const id of rest) bodies.delete(id);
    bodies.set(first, scope.keep(joined.shape));
    return { bodies, names: new Map([[first, joined.names]]), previewTools: preview() };
  }

  const op = operation === 'cut' ? 'cut' : 'common';
  const changed = new Map<BodyId, NamedShape | undefined>();
  for (const id of targets) {
    const before = named(id);
    const result = namedBoolean(kernel, op, before, tool, options);
    scope.track(result.shape);
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
  return { bodies, names, previewTools: preview() };
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
  const solids = kernel.solids(tool);
  for (const solid of solids) scope.track(solid);
  // One solid (or something that has none): the exact distance to the whole tool.
  if (solids.length < 2) {
    return near.filter(({ shape }) => kernel.distance(shape, tool) <= TOUCH).map(({ id }) => id);
  }
  const parts = solids.map((shape) => ({ shape, box: kernel.measure(shape).bbox }));
  return near
    .filter(({ shape, box }) =>
      parts.some(
        (part) => boxesTouch(box, part.box) && kernel.distance(shape, part.shape) <= TOUCH,
      ),
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
