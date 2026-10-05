/**
 * The Combine feature in the kernel (P3-06, ADR-0044, FR-FT-09): a target
 * body joined with, cut by or intersected with tool bodies, through the
 * naming service's booleans (`namedBoolean`), so the target's faces keep
 * their names and the tools' faces that end up in the result carry theirs.
 * The result keeps the target's ID; the tools are taken out of the body set
 * unless `keepTools`. Unlike extrude's operations, which work on the bodies
 * a new solid happens to touch, Combine is explicit and strict: a join of
 * bodies that don't touch, a cut that removes nothing and an intersection
 * that leaves nothing are errors with a message, not silent no-ops.
 */
import {
  type BodyId,
  type CombineInputs,
  combineFeature,
  combineSettings,
  type GeomRef,
} from '@extrudo/core';
import { KernelError, type ShapeHandle } from '../kernel';
import type { TopoNames } from '../naming/names';
import { type NamedShape, namedBoolean } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { nameMeshBodies, warnIfBecameMesh } from './mesh-bodies';
import { bodiesTouch } from './operation';

export const kernelCombine: KernelFeatureDefinition<CombineInputs> = {
  ...combineFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateCombine,
};

function evaluateCombine(ctx: EvalContext<CombineInputs>): FeatureOutput {
  const { kernel } = ctx;
  const settings = combineSettings(ctx.inputs);
  if (!settings.target) throw new KernelError('Pick the target body.');
  if (settings.tools.length === 0) throw new KernelError('Pick at least one tool body.');
  const bodyOf = (ref: GeomRef, what: string): BodyId => {
    if (!ctx.bodies.has(ref.id as BodyId)) {
      throw new LostReferenceError(
        `The ${what} no longer exists. Edit ${ctx.feature.name} and pick it again.`,
        { kind: 'body', id: ref.id },
      );
    }
    return ref.id as BodyId;
  };
  const target = bodyOf(settings.target, 'target body');
  const tools = settings.tools.map((ref) => bodyOf(ref, 'tool body'));
  if (tools.includes(target)) throw new KernelError("The target can't be one of its own tools.");

  const named = (id: BodyId): NamedShape => ({
    shape: ctx.bodies.get(id) as ShapeHandle,
    names: ctx.names(id),
  });
  const options = { feature: ctx.feature.id, op: 'combine' };
  const volume = (shape: ShapeHandle) => kernel.measure(shape).volume;
  // A mesh body has no B-rep distance, so a pair with a mesh in it is asked
  // manifold-3d's `minGap` (ADR-0066 §4).
  const touches = (a: ShapeHandle, b: ShapeHandle): boolean => bodiesTouch(ctx, a, b);
  const empty = (was: number, now: number) => now <= 1e-6 * Math.max(1, Math.abs(was));

  using scope = kernel.scope();
  let result: NamedShape;
  switch (settings.operation) {
    case 'join': {
      // Tools join as they are reached, so a chain (target - A - B) works in any order.
      let current = named(target);
      const pending = [...tools];
      while (pending.length > 0) {
        const at = pending.findIndex((id) => touches(current.shape, named(id).shape));
        if (at < 0) {
          throw new KernelError(
            pending.length === 1
              ? "The tool body doesn't touch the target, so it can't be joined. Move them together, or pick another body."
              : `${pending.length} tool bodies don't touch the target, so they can't be joined. Move them together, or pick other bodies.`,
          );
        }
        const [id] = pending.splice(at, 1) as [BodyId];
        const before = current.shape;
        current = namedBoolean(kernel, 'fuse', current, named(id), { ...options, simplify: true });
        scope.track(current.shape);
        warnIfBecameMesh(ctx, before, current.shape);
      }
      result = current;
      break;
    }
    case 'cut': {
      let current = named(target);
      for (const id of tools) {
        const before = current.shape;
        current = namedBoolean(kernel, 'cut', current, named(id), options);
        scope.track(current.shape);
        warnIfBecameMesh(ctx, before, current.shape);
      }
      const was = volume(named(target).shape);
      const now = volume(current.shape);
      if (empty(was, now)) {
        throw new KernelError('The cut would remove the whole target. Pick other tool bodies.');
      }
      if (Math.abs(was - now) <= 1e-6 * Math.max(1, Math.abs(was))) {
        throw new KernelError(
          "The tool bodies don't overlap the target, so the cut removes nothing. Move them into it, or pick other bodies.",
        );
      }
      result = current;
      break;
    }
    case 'intersect': {
      // What the target shares with the tools taken together.
      let tool = named(tools[0] as BodyId);
      for (const id of tools.slice(1)) {
        tool = namedBoolean(kernel, 'fuse', tool, named(id), options);
        scope.track(tool.shape);
      }
      const current = namedBoolean(kernel, 'common', named(target), tool, options);
      scope.track(current.shape);
      warnIfBecameMesh(ctx, named(target).shape, current.shape);
      if (empty(volume(named(target).shape), volume(current.shape))) {
        throw new KernelError(
          "The target doesn't overlap the tool bodies, so nothing is left after intersecting. Move them into each other, or pick other bodies.",
        );
      }
      result = current;
      break;
    }
  }

  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>([[target, result.names]]);
  bodies.set(target, scope.keep(result.shape));
  if (!settings.keepTools) for (const id of tools) bodies.delete(id);
  // The tools, drawn in the operation's style while a dialog previews it.
  const previewTools = tools.map((id) => ({
    shape: ctx.bodies.get(id) as ShapeHandle,
    style: settings.operation,
  }));
  return nameMeshBodies(ctx, splitSolids(ctx, scope, { bodies, names, previewTools }));
}
