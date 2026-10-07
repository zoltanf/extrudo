import {
  type FeatureId,
  type GeomRef,
  parseSketchEntityRefId,
  type SketchEntityId,
  type SweepInputs,
  type SweepReport,
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
  type Vec3,
} from '../kernel';
import { type NamedShape, namedSweep, type SweepSource } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { explicitBodies, type OperationWords, operate } from './operation';
import type { SketchOutputData } from './sketch';
import { baseOf } from './sources';
import { dot, length, scale, sub, unit } from './vec';

/** How a sweep speaks of itself (the shared operation code, `operation.ts`). */
const WORDS: OperationWords = { noun: 'sweep', check: 'Check its profile and path.' };

/** Ends of path pieces closer than this (mm) meet. */
export const PATH_JOIN = 1e-3;

/**
 * How far the profile may sit from the path's start line before the sweep
 * warns (P4-12, ADR-0067 §H5): a fraction of the path's length, or half a
 * millimetre, whichever is larger.
 */
export const PROFILE_PLACEMENT = (pathLength: number) => Math.max(0.01 * pathLength, 0.5);

/**
 * The sweep feature in the kernel (P4-01, ADR-0055): sketch profiles and
 * flat faces (united when there are several, in one plane) moved along a
 * path of sketch curves and edges chained end to end, then new bodies or a
 * join, cut or intersection like extrude. Faces are named (ADR-0005)
 * `sweep:<id>:cap:start` (the profile's own place), `cap:end`, and
 * `side:<sketch curve>` or `side:(<body edge>)` for each profile edge.
 * A profile further than `PROFILE_PLACEMENT` from the path's start line
 * warns (P4-12, ADR-0067 §H5).
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
  const placement = placementReport(ctx, base.source.shape, path, warnings);
  const result = splitSolids(
    ctx,
    scope,
    operate(ctx, scope, settings, tool, participants, warnings, WORDS),
  );
  return {
    ...result,
    ...(warnings.length ? { warnings } : {}),
    ...(placement && { report: placement }),
  };
}

/**
 * How far the profile sits from the path's start, across the path (P4-12,
 * ADR-0067 §H5): the swept profile is placed exactly where its sketch drew
 * it, at the point the path runs from, so a section that isn't on the path's
 * start line sweeps parallel to it and off to one side — B10's link came out
 * with 6 mm walls instead of 3. The profile's centroid is measured against
 * the start point and the line the path runs along there, so a profile drawn
 * anywhere along the path is fine (its place along it shifts the whole
 * sweep); only its offset across the path is wrong.
 */
export function placementOffset(
  ctx: EvalContext,
  profile: ShapeHandle,
  path: ShapeHandle,
): number | undefined {
  const kernel = ctx.kernel;
  const start = pathStart(kernel, path);
  if (!start) return undefined;
  const centre = kernel.properties(profile).centroid;
  const along = unit(start.tangent);
  const off = sub(centre, start.point);
  if (length(off) < 1e-9) return 0;
  const across = sub(off, scale(along, dot(off, along)));
  return length(across);
}

/** The path's start point and the direction it runs in there, or undefined if it has none. */
function pathStart(
  kernel: EvalContext['kernel'],
  path: ShapeHandle,
): { point: Vec3; tangent: Vec3 } | undefined {
  if (kernel.count(path, 'edge') < 1) return undefined;
  const geometry = kernel.edgeGeometry(path, 0, 4);
  if (geometry.type === 'degenerate' || geometry.points.length < 2) return undefined;
  const points = geometry.points;
  const point = points[0] as Vec3;
  // The samples are along the edge in its own direction, so the one furthest
  // from the start gives the direction (a closed edge's last sample is the
  // start again, and the one across it is the direction).
  let far = point;
  let best = 0;
  for (const p of points) {
    const d = length(sub(p, point));
    if (d > best) {
      best = d;
      far = p;
    }
  }
  const tangent = sub(far, point);
  return best > 1e-9 ? { point, tangent } : undefined;
}

/**
 * Measures the placement and warns when it is off (P4-12, ADR-0067 §H5):
 * the numbers go out again as the feature's `SweepReport` (the dialog's
 * placement line), so the person sees them before OK. Undefined when the
 * profile or the path can't be measured; the warning's wording and
 * threshold are unchanged.
 */
function placementReport(
  ctx: EvalContext,
  profile: ShapeHandle,
  path: ShapeHandle,
  warnings: string[],
): SweepReport | undefined {
  const offset = placementOffset(ctx, profile, path);
  if (offset === undefined) return undefined;
  const { length: pathLength } = ctx.kernel.properties(path);
  const limit = PROFILE_PLACEMENT(pathLength);
  if (offset > limit) {
    const d = Math.round(offset * 10) / 10;
    warnings.push(
      `The profile is swept where it is drawn, ${d} mm from the path's start: draw it centred on the path's start to sweep it around the path.`,
    );
  }
  return { kind: 'sweep', offset, limit, pathLength };
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
