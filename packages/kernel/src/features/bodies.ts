/**
 * Body bookkeeping shared by the features that change the body set (P2-08,
 * ADR-0030): one body per solid, and the Remove feature.
 */
import { type BodyId, type RemoveInputs, removeBodiesFeature } from '@extrudo/core';
import { KernelError, type ShapeHandle, type ShapeScope, type Vec3 } from '../kernel';
import { compareGeometry, deriveNames, type TopoNames } from '../naming/names';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';

/** Relative volume difference below which two pieces count as the same size. */
const SAME_VOLUME = 1e-6;

/**
 * Splits every body a feature made or changed (those it gives a naming
 * table in `names`) that holds several separate solids into one body per
 * solid: a cut through the middle of a bar leaves two bars, not one body
 * of two pieces (ADR-0028's open item).
 *
 * The **largest** piece keeps the body's ID, so its name, colour and the
 * references to it stay with the bulk of the part; the other pieces get
 * the feature's next free body IDs, `<feature>:<n>` (`ctx.bodyId`), in
 * geometric order (bounding-box centre by x, then y, then z). Each piece
 * keeps the face names of the whole; edges and vertices are named again
 * from them. New pieces come right after the body they came from.
 *
 * Call it on an evaluator's result before returning it, inside the
 * evaluator's shape scope: split shapes go back to the scope; bodies passed
 * on unchanged (the handles in `ctx.bodies`) are never split.
 */
export function splitSolids<T extends Pick<FeatureOutput, 'bodies' | 'names'>>(
  ctx: EvalContext,
  scope: ShapeScope,
  output: T,
): T {
  const { kernel } = ctx;
  if (!output.bodies || !output.names) return output;
  const before = new Set(ctx.bodies.values());
  const pieces = new Map<BodyId, { id: BodyId; shape: ShapeHandle; names: TopoNames }[]>();
  const used = new Set(output.bodies.keys());
  let next = 0;
  const freshId = (): BodyId => {
    let id = ctx.bodyId(next++);
    while (used.has(id)) id = ctx.bodyId(next++);
    used.add(id);
    return id;
  };

  for (const [id, table] of output.names) {
    const whole = output.bodies.get(id);
    if (whole === undefined || before.has(whole)) continue;
    const solids = kernel.solids(whole);
    for (const solid of solids) scope.track(solid);
    if (solids.length < 2) continue;
    const measured = solids.map((solid) => {
      const { volume, bbox } = kernel.measure(solid);
      const center: Vec3 = [
        (bbox.min[0] + bbox.max[0]) / 2,
        (bbox.min[1] + bbox.max[1]) / 2,
        (bbox.min[2] + bbox.max[2]) / 2,
      ];
      return { solid, volume, center };
    });
    measured.sort((a, b) => compareGeometry(a.center, b.center));
    const largest = measured.reduce((best, piece) =>
      piece.volume > best.volume * (1 + SAME_VOLUME) ? piece : best,
    );
    const ordered = [largest, ...measured.filter((piece) => piece !== largest)];
    pieces.set(
      id,
      ordered.map(({ solid }, i) => {
        const faces = kernel.locate(solid, whole, 'face').map((at) => table.faces[at] ?? '');
        return {
          id: i === 0 ? id : freshId(),
          shape: scope.keep(solid),
          names: deriveNames(faces, kernel.describe(solid)),
        };
      }),
    );
    // The whole goes, unless the output still holds it elsewhere.
    const held = new Set([
      ...Object.values((output as FeatureOutput).shapes ?? {}),
      ...((output as FeatureOutput).previewTools ?? []).map((t) => t.shape),
    ]);
    if (!held.has(whole)) scope.track(whole);
  }
  if (pieces.size === 0) return output;

  const bodies = new Map<BodyId, ShapeHandle>();
  const names = new Map(output.names);
  for (const [id, shape] of output.bodies) {
    const split = pieces.get(id);
    if (!split) {
      bodies.set(id, shape);
      continue;
    }
    for (const piece of split) {
      bodies.set(piece.id, piece.shape);
      names.set(piece.id, piece.names);
    }
  }
  return { ...output, bodies, names };
}

/**
 * The Remove feature in the kernel (P2-08, ADR-0030): the body set without
 * the bodies it names. A body that no longer exists (an earlier edit made
 * fewer bodies) is an error, like an extrude's missing participant.
 */
export const kernelRemove: KernelFeatureDefinition<RemoveInputs> = {
  ...removeBodiesFeature,
  bodyAccess: () => 'write',
  evaluate(ctx) {
    const ids = ctx.inputs.bodies.refs.map((ref) => ref.id as BodyId);
    const missing = ids.filter((id) => !ctx.bodies.has(id));
    if (missing.length > 0) {
      throw new KernelError(
        ids.length === 1
          ? 'The body to remove no longer exists: an earlier change took it away. Delete this Remove, or undo that change.'
          : `${missing.length} of the bodies to remove no longer exist: an earlier change took them away. Edit or delete this Remove, or undo that change.`,
      );
    }
    const bodies = new Map(ctx.bodies);
    for (const id of ids) bodies.delete(id);
    return { bodies };
  },
};
