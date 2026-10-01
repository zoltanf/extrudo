/**
 * The Split Body feature in the kernel (P3-08, FR-FT-12): cuts each body
 * along a plane (an origin or construction plane, or a flat face's plane)
 * into the part above the plane (along its normal) and the part below.
 *
 * No facade change: each side is the common part of the body and a box
 * that holds everything on that side of the plane, sized from the body so
 * it reaches past it everywhere. Both sides are named through the booleans' history, then
 * named again as one shape, so a face the plane cuts in two keeps its name
 * with `#1` and `#2` (the same as any feature that splits a face: the names
 * stay unique across the pieces, ADR-0005), and `splitSolids` makes a body
 * of every solid: the largest keeps the body's ID and name, the others get
 * `<feature>:<n>` (ADR-0030). The new faces where the plane cut are
 * `split:<feature>:cut:above` (on the part above, facing down the normal)
 * and `split:<feature>:cut:below`.
 *
 * A body the plane doesn't cut stays whole, with a warning; if none is cut,
 * that is an error. Keeping one side that has nothing of a body is an error
 * too (the body would disappear).
 */
import {
  type BodyId,
  type SketchFrame,
  type SplitBodyInputs,
  type SplitKeep,
  splitBodyFeature,
  splitBodySettings,
} from '@extrudo/core';
import { KernelError, type ShapeHandle, type ShapeScope } from '../kernel';
import { deriveNames, type TopoNames } from '../naming/names';
import { type NamedShape, namedBoolean } from '../naming/ops';
import { createdName } from '../naming/topo-id';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import type { Matrix12 } from './matrix';
import { planeOf } from './references';
import { existing } from './transform';
import { add, dot, length, scale, sub } from './vec';

export const kernelSplitBody: KernelFeatureDefinition<SplitBodyInputs> = {
  ...splitBodyFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateSplitBody,
};

/** Volume below which a side counts as nothing (mm³). */
const NOTHING = 1e-6;

function evaluateSplitBody(ctx: EvalContext<SplitBodyInputs>): FeatureOutput {
  const { kernel } = ctx;
  const settings = splitBodySettings(ctx.inputs);
  const ids = existing(ctx, settings.bodies, 'split');
  if (!settings.plane) throw new KernelError('Pick the plane to split along.');
  const { frame } = planeOf(ctx, settings.plane, 'the splitting plane');

  using scope = kernel.scope();
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  let whole = 0;
  for (const id of ids) {
    const body: NamedShape = { shape: ctx.bodies.get(id) as ShapeHandle, names: ctx.names(id) };
    const split = splitOne(ctx, scope, body, frame, settings.keep);
    if (!split) {
      whole++;
      continue;
    }
    bodies.set(id, split.shape);
    names.set(id, split.names);
  }
  if (whole === ids.length) {
    throw new KernelError(
      ids.length === 1
        ? "The plane doesn't cut the body: it lies wholly on one side. Pick a plane that goes through it."
        : "The plane doesn't cut any of the bodies: each lies wholly on one side. Pick a plane that goes through them.",
    );
  }
  if (whole > 0) {
    ctx.warn(
      whole === 1
        ? "The plane doesn't cut one of the bodies, so it stays whole."
        : `The plane doesn't cut ${whole} of the bodies, so they stay whole.`,
    );
  }
  // Kept now: splitSolids takes the compounds apart, the pieces go back to the scope.
  for (const [id, shape] of bodies) if (names.has(id)) scope.keep(shape);
  return splitSolids(ctx, scope, { bodies, names });
}

/**
 * One body split along the plane: the sides that are kept, as one named
 * shape (a compound of both, or the one side), tracked in `scope`; or
 * `undefined` when the plane doesn't cut the body.
 */
function splitOne(
  ctx: EvalContext,
  scope: ShapeScope,
  body: NamedShape,
  frame: SketchFrame,
  keep: SplitKeep,
): NamedShape | undefined {
  const { kernel } = ctx;
  const total = kernel.measure(body.shape).volume;
  const sides: NamedShape[] = [];
  let above = 0;
  let below = 0;
  for (const side of ['above', 'below'] as const) {
    const tool = halfSpace(ctx, scope, body.shape, frame, side);
    const piece = namedBoolean(kernel, 'common', body, tool, {
      feature: ctx.feature.id,
      op: 'split',
    });
    scope.track(piece.shape);
    const solids = kernel.solids(piece.shape);
    for (const solid of solids) scope.track(solid);
    const volume = solids.length > 0 ? kernel.measure(piece.shape).volume : 0;
    if (side === 'above') above = volume;
    else below = volume;
    if (keep === 'both' || keep === side) sides.push(piece);
  }
  const tiny = Math.max(NOTHING, total * 1e-9);
  if (above <= tiny || below <= tiny) {
    // Wholly on one side: a kept side with nothing in it would take the body away.
    const empty = keep === 'above' ? above <= tiny : keep === 'below' ? below <= tiny : false;
    if (empty) {
      throw new KernelError(
        `Nothing of the body is ${keep} the plane, so nothing would be left. Keep the other side, or both.`,
      );
    }
    return undefined;
  }
  const [first, second] = sides;
  if (!first) return undefined;
  if (!second) return first;
  // Both sides as one shape, named as a whole: a face cut in two gets #1 and #2.
  const compound = scope.track(kernel.compound([first.shape, second.shape]));
  const raw: string[] = new Array(kernel.count(compound, 'face')).fill('');
  for (const side of sides) {
    kernel.locate(side.shape, compound, 'face').forEach((at, i) => {
      if (at >= 0) raw[at] = side.names.faces[i] ?? '';
    });
  }
  return { shape: compound, names: deriveNames(raw, kernel.describe(compound)) };
}

/**
 * A box that holds everything of `shape` on one side of the plane, its
 * face on the plane named `split:<feature>:cut:<side>` (so are its other
 * faces, which never reach the body). Tracked in `scope`.
 */
function halfSpace(
  ctx: EvalContext,
  scope: ShapeScope,
  shape: ShapeHandle,
  frame: SketchFrame,
  side: 'above' | 'below',
): NamedShape {
  const { kernel } = ctx;
  const { bbox } = kernel.measure(shape);
  const centre = scale(add(bbox.min, bbox.max), 0.5);
  const { origin, normal } = frame;
  const offset = dot(sub(centre, origin), normal);
  // The centre's foot on the plane, and a size that reaches past the body everywhere.
  const foot = sub(centre, scale(normal, offset));
  const size = 2 * length(sub(bbox.max, bbox.min)) + Math.abs(offset) + 10;
  const box = scope.track(kernel.box([2 * size, 2 * size, size], [-size, -size, 0]));
  // Local x, y and the normal (above) or its reverse (below) as the box's axes.
  const n = side === 'above' ? normal : scale(normal, -1);
  const x = frame.x;
  const y = side === 'above' ? frame.y : scale(frame.y, -1);
  const matrix = [
    x[0],
    y[0],
    n[0],
    foot[0],
    x[1],
    y[1],
    n[1],
    foot[1],
    x[2],
    y[2],
    n[2],
    foot[2],
  ] as unknown as Matrix12;
  const placed = scope.track(kernel.transform(box, matrix).shape);
  const name = createdName('split', ctx.feature.id, 'cut', side);
  const d = kernel.describe(placed);
  return {
    shape: placed,
    names: {
      faces: d.faces.map(() => name),
      edges: d.edges.map(() => `e[${name}]`),
      vertices: d.vertices.map(() => `v[${name}]`),
    },
  };
}
