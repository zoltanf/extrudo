import {
  type FeatureId,
  type GeomRef,
  parseSketchEntityRefId,
  type SketchEntityId,
  type SweepInputs,
  sweepFeature,
  sweepSettings,
} from '@extrudo/core';
import {
  KernelError,
  PathError,
  type PathPiece,
  type ShapeHandle,
  type ShapeScope,
  SweepError,
} from '../kernel';
import { type NamedShape, namedSweep, type SweepSource } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { explicitBodies, type OperationWords, operate } from './operation';
import type { SketchOutputData } from './sketch';
import { baseOf } from './sources';

/** How a sweep speaks of itself (the shared operation code, `operation.ts`). */
const WORDS: OperationWords = { noun: 'sweep', check: 'Check its profile and path.' };

/** Ends of path pieces closer than this (mm) meet. */
export const PATH_JOIN = 1e-3;

/**
 * The sweep feature in the kernel (P4-01, ADR-0055): sketch profiles and
 * flat faces (united when there are several, in one plane) moved along a
 * path of sketch curves and edges chained end to end, then new bodies or a
 * join, cut or intersection like extrude. Faces are named (ADR-0005)
 * `sweep:<id>:cap:start` (the profile's own place), `cap:end`, and
 * `side:<sketch curve>` or `side:(<body edge>)` for each profile edge.
 */
export const kernelSweep: KernelFeatureDefinition<SweepInputs> = {
  ...sweepFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateSweep,
};

function evaluateSweep(ctx: EvalContext<SweepInputs>): FeatureOutput {
  const settings = sweepSettings(ctx.inputs);
  if (settings.profiles.length === 0) {
    throw new KernelError('Pick at least one profile or face to sweep.');
  }
  if (settings.path.length === 0) {
    throw new KernelError('Pick the path to sweep along: sketch curves or edges.');
  }
  const twist = settings.twist ? ctx.value(settings.twist) : 0;
  const scale = settings.scale ? ctx.value(settings.scale) : 1;
  if (!(scale > 1e-6)) throw new KernelError('The scale must be greater than 0.');
  if (Math.abs(twist) > 1e-9 && settings.orientation === 'fixed') {
    throw new KernelError(
      "A profile that stays fixed can't twist. Set the twist to 0, or let the profile follow the path.",
    );
  }
  using scope = ctx.kernel.scope();
  const base = baseOf(ctx as unknown as EvalContext, scope, settings.profiles, WORDS.noun);
  const path = pathOf(ctx as unknown as EvalContext, scope, settings.path);
  const tool = sweepTool(ctx as unknown as EvalContext, scope, base.source, path, {
    orientation: settings.orientation,
    twist: (twist * Math.PI) / 180,
    scale,
  });
  const participants = explicitBodies(ctx, settings, WORDS);
  const warnings: string[] = [];
  const result = splitSolids(
    ctx,
    scope,
    operate(ctx, scope, settings, tool, participants, warnings, WORDS),
  );
  return { ...result, ...(warnings.length ? { warnings } : {}) };
}

/**
 * The path the references make, as a wire (tracked in the scope): sketch
 * curves exact from their sketch's output, edges as they are. The kernel
 * chains them end to end.
 */
export function pathOf(ctx: EvalContext, scope: ShapeScope, refs: readonly GeomRef[]): ShapeHandle {
  const pieces: PathPiece[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pieces.push(pieceOf(ctx, ref));
  }
  try {
    return scope.track(ctx.kernel.path(pieces, PATH_JOIN));
  } catch (error) {
    if (error instanceof PathError) {
      throw new KernelError(
        "The pieces of the path don't join end to end. Pick curves or edges that meet in one chain, without branches.",
      );
    }
    throw error;
  }
}

function pieceOf(ctx: EvalContext, ref: GeomRef): PathPiece {
  if (ref.kind === 'edge') {
    const hit = ctx.resolve(ref, { label: 'an edge of the path' });
    if (hit.kind !== 'edge') throw new KernelError('Pick edges or sketch curves for the path.');
    return { kind: 'edge', shape: hit.shape, edge: hit.index };
  }
  if (ref.kind !== 'sketchEntity') {
    throw new KernelError('A path is made of sketch curves and edges. Pick those.');
  }
  const parsed = parseSketchEntityRefId(ref.id);
  let data: Partial<SketchOutputData> | undefined;
  try {
    data = parsed && (ctx.output(parsed.feature as FeatureId).data as Partial<SketchOutputData>);
  } catch {
    data = undefined;
  }
  const entity = parsed?.entity as SketchEntityId | undefined;
  if (data?.points && entity && entity in data.points) {
    throw new KernelError('A path is made of curves, not points. Pick sketch curves or edges.');
  }
  const curve = entity ? data?.exact?.[entity] : undefined;
  if (!data?.frame || !curve) {
    throw new LostReferenceError(
      "Can't find a curve of the path any more: an earlier change to its sketch removed it. Edit the sweep and pick the path again.",
      ref,
    );
  }
  const { origin, x, normal } = data.frame;
  return { kind: 'curve', curve, frame: { origin, x, normal } };
}

/**
 * A profile swept along a path, named, as `operate` takes it; the kernel's
 * reasons worded for people. Shared with the coil (P4-01) and P4-02's threads.
 */
export function sweepTool(
  ctx: EvalContext,
  scope: ShapeScope,
  source: SweepSource,
  path: ShapeHandle,
  options: {
    orientation: 'follow' | 'fixed' | { binormal: readonly [number, number, number] };
    twist?: number;
    scale?: number;
    verify?: boolean;
    op?: string;
  },
): NamedShape {
  try {
    const tool = namedSweep(ctx.kernel, {
      feature: ctx.feature.id,
      op: options.op ?? 'sweep',
      ...source,
      path,
      sweep: {
        orientation: options.orientation,
        twist: options.twist ?? 0,
        scale: options.scale ?? 1,
        verify: options.verify ?? true,
      },
    });
    scope.track(tool.shape);
    return tool;
  } catch (error) {
    if (!(error instanceof SweepError)) throw error;
    switch (error.problem.kind) {
      case 'crosses':
        throw new KernelError(
          'The sweep runs into itself: the profile is too big for a bend of the path, or the path comes back too close. Make the profile smaller or the bends wider.',
        );
      case 'twist-corner':
        throw new KernelError(
          'A twisted sweep needs a smooth path. Round the sharp corners of the path, or set the twist to 0.',
        );
      case 'closed-scale':
        throw new KernelError(
          "A sweep along a closed path can't change the profile's size. Set the scale to 1.",
        );
      default:
        throw new KernelError(
          "Couldn't sweep the profile along this path. A bend may be too tight for the profile, or a corner too sharp.",
        );
    }
  }
}
