/**
 * The Scale feature in the kernel (P3-08, FR-FT-12): bodies made larger or
 * smaller about a point (a vertex, a construction point, or the centre of
 * the bodies' box), by one factor or by one per world axis, in place or as
 * copies. The facade's `scale` rebuilds the geometry (a uniform scale keeps
 * every surface's type; a non-uniform one turns curved faces into
 * B-splines but keeps flat faces flat and straight edges straight), and
 * every face, edge and vertex is the image of the one before, so names
 * carry over (ADR-0005) and a fillet on a scaled body survives a change of
 * factor. A copy's faces get names of their own, as Move's copies do
 * (`scale:<feature>:from:(<name>)`, ADR-0044).
 */
import { type ScaleInputs, scaleFeature, scaleSettings } from '@extrudo/core';
import { KernelError, type ShapeHandle, type Vec3 } from '../kernel';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { transformedNames } from './mesh-bodies';
import { pointOf } from './references';
import { centreOf, existing, type Image, withImages } from './transform';

export const kernelScale: KernelFeatureDefinition<ScaleInputs> = {
  ...scaleFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateScale,
};

function evaluateScale(ctx: EvalContext<ScaleInputs>): FeatureOutput {
  const { kernel } = ctx;
  const settings = scaleSettings(ctx.inputs);
  const ids = existing(ctx, settings.bodies, 'scale');
  const factors = factorsOf(ctx, settings.mode);
  if (factors.every((f) => Math.abs(f - 1) < 1e-12)) {
    ctx.warn(
      settings.copy
        ? 'Nothing changes size, so the copy sits exactly on the original.'
        : 'Nothing changes size: every factor is 1.',
    );
  }
  const centre = settings.point
    ? pointOf(ctx, settings.point, 'the point to scale about')
    : centreOf(ctx, ids);

  using scope = kernel.scope();
  const images: Image[] = ids.map((source, i) => {
    // A mesh body is scaled by the same 3 × 4 matrix Move and Mirror use
    // (ADR-0066 §4), and its one face follows Move's rule (a copy gets its own
    // name, a plain scale keeps the one it had).
    const result = kernel.scale(ctx.bodies.get(source) as ShapeHandle, centre, factors);
    const names = transformedNames(ctx, result, ctx.names(source), {
      op: 'scale',
      ...(settings.copy ? { role: 'from' } : {}),
    });
    scope.track(result.shape);
    return {
      source,
      id: settings.copy ? ctx.bodyId(i) : source,
      named: { shape: result.shape, names },
    };
  });
  return withImages(ctx, scope, images);
}

/** The factors along X, Y and Z: one for all (uniform) or one each, every one greater than 0. */
function factorsOf(ctx: EvalContext<ScaleInputs>, mode: 'uniform' | 'non-uniform'): Vec3 {
  const read = (name: 'factor' | 'x' | 'y' | 'z', label: string) => {
    const value = ctx.inputs[name] ? ctx.value(name) : 1;
    if (!Number.isFinite(value) || value <= 0) {
      throw new KernelError(
        `The ${label} is ${formatNumber(value)}. Scale factors must be greater than 0 (use Mirror to turn a body over).`,
      );
    }
    return value;
  };
  if (mode === 'uniform') {
    const f = read('factor', 'scale factor');
    return [f, f, f];
  }
  return [read('x', 'X factor'), read('y', 'Y factor'), read('z', 'Z factor')];
}

const formatNumber = (value: number) =>
  Number.isFinite(value) ? Number.parseFloat(value.toFixed(4)).toString() : String(value);
