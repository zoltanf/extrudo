import {
  type FeatureId,
  type GeomRef,
  type LoftInputs,
  loftFeature,
  loftSettings,
  parseSketchEntityRefId,
  type SketchEntityId,
  sketchToWorld,
} from '@extrudo/core';
import { KernelError, LoftError, type ShapeScope, type Vec3 } from '../kernel';
import { type NamedShape, namedLoft, type SweepSource } from '../naming/ops';
import { LostReferenceError } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';
import { splitSolids } from './bodies';
import { explicitBodies, type OperationWords, operate } from './operation';
import { pointOf } from './references';
import type { SketchOutputData } from './sketch';
import { coplanar, type Plane, partsOf } from './sources';

/** How a loft speaks of itself (the shared operation code, `operation.ts`). */
const WORDS: OperationWords = { noun: 'loft', check: 'Check its sections.' };

/** A section as the kernel lofts it: a face with its edges' sources, or a point. */
type Section = (SweepSource & { plane: Plane }) | { point: Vec3 };

/**
 * The loft feature in the kernel (P4-01, ADR-0055): a solid through
 * sections in order (sketch profiles, flat faces, a point at either end),
 * smooth or ruled, optionally closed, then new bodies or a join, cut or
 * intersection like extrude. Faces are named (ADR-0005) `loft:<id>:cap:start`
 * (the first section), `cap:end` (the last), and `side:<sketch curve>` or
 * `side:(<body edge>)` after the edge of the earliest section that bounds it.
 */
export const kernelLoft: KernelFeatureDefinition<LoftInputs> = {
  ...loftFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateLoft,
};

function evaluateLoft(ctx: EvalContext<LoftInputs>): FeatureOutput {
  const settings = loftSettings(ctx.inputs);
  const refs = settings.sections;
  if (refs.length < 2) {
    throw new KernelError('Pick at least two sections to loft through, in order.');
  }
  if (settings.closed && refs.length < 3) {
    throw new KernelError('A closed loft needs at least three sections. Pick another, or open it.');
  }
  using scope = ctx.kernel.scope();
  const sections = refs.map((ref, i) =>
    sectionOf(ctx as unknown as EvalContext, scope, ref, i, refs.length, settings.closed),
  );
  if (sections.every((s) => 'point' in s)) {
    throw new KernelError('A loft needs at least one profile or face, not only points.');
  }
  // Neighbours in one plane make no solid between them.
  sections.forEach((section, i) => {
    const next = sections[(i + 1) % sections.length] as Section;
    if (i + 1 === sections.length && !settings.closed) return;
    if ('plane' in section && 'plane' in next && coplanar(section.plane, next.plane)) {
      const j = ((i + 1) % sections.length) + 1;
      throw new KernelError(
        `Sections ${Math.min(i + 1, j)} and ${Math.max(i + 1, j)} lie in one plane. Loft between sections on different planes.`,
      );
    }
  });
  const tool = loftTool(ctx as unknown as EvalContext, scope, sections, settings);
  const participants = explicitBodies(ctx, settings, WORDS);
  const warnings: string[] = [];
  const result = splitSolids(
    ctx,
    scope,
    operate(ctx, scope, settings, tool, participants, warnings, WORDS),
  );
  return { ...result, ...(warnings.length ? { warnings } : {}) };
}

function sectionOf(
  ctx: EvalContext,
  scope: ShapeScope,
  ref: GeomRef,
  index: number,
  count: number,
  closed: boolean,
): Section {
  if (ref.kind === 'profile' || ref.kind === 'face') {
    const [part] = partsOf(ctx, scope, [ref], WORDS.noun);
    if (!part) throw new KernelError(`Section ${index + 1} is missing. Pick it again.`);
    return { ...part.source, plane: part.plane };
  }
  if (closed || (index !== 0 && index !== count - 1)) {
    throw new KernelError(
      closed
        ? "A closed loft can't go through a point. Pick profiles or faces, or open the loft."
        : `Section ${index + 1} is a point: a point can only start or end a loft. Move it to an end.`,
    );
  }
  const label = `section ${index + 1}`;
  if (ref.kind === 'point' || ref.kind === 'vertex') return { point: pointOf(ctx, ref, label) };
  if (ref.kind === 'sketchEntity') return { point: sketchPoint(ctx, ref, label) };
  throw new KernelError('Pick sketch profiles, flat faces or points as sections.');
}

/** A sketch point (`<sketch>/<point>`) in the world. */
function sketchPoint(ctx: EvalContext, ref: GeomRef, label: string): Vec3 {
  const parsed = parseSketchEntityRefId(ref.id);
  let data: Partial<SketchOutputData> | undefined;
  try {
    data = parsed && (ctx.output(parsed.feature as FeatureId).data as Partial<SketchOutputData>);
  } catch {
    data = undefined;
  }
  const point = parsed ? data?.points?.[parsed.entity as SketchEntityId] : undefined;
  if (!data?.frame || !point) {
    if (parsed && data?.exact?.[parsed.entity as SketchEntityId]) {
      throw new KernelError(
        `${label.charAt(0).toUpperCase()}${label.slice(1)} is a sketch curve. Pick its profile, or a point.`,
      );
    }
    throw new LostReferenceError(
      `Can't find ${label} any more: an earlier change to its sketch removed it. Edit the loft and pick it again.`,
      ref,
    );
  }
  return sketchToWorld(data.frame, point);
}

/** The lofted tool, named; the kernel's reasons worded for people. */
function loftTool(
  ctx: EvalContext,
  scope: ShapeScope,
  sections: readonly Section[],
  settings: { ruled: boolean; closed: boolean },
): NamedShape {
  try {
    const tool = namedLoft(ctx.kernel, {
      feature: ctx.feature.id,
      sections,
      ruled: settings.ruled,
      closed: settings.closed,
    });
    scope.track(tool.shape);
    return tool;
  } catch (error) {
    if (!(error instanceof LoftError)) throw error;
    const problem = error.problem;
    switch (problem.kind) {
      case 'holes':
        throw new KernelError(
          `Section ${problem.section + 1} has a hole: a loft goes through outlines only. Pick a profile without holes.`,
        );
      case 'not-one-face':
        throw new KernelError(
          `Section ${problem.section + 1} is more than one face. Pick one profile or face per section.`,
        );
      case 'point-inside':
        throw new KernelError(
          `Section ${problem.section + 1} is a point: a point can only start or end a loft.`,
        );
      case 'crosses':
        throw new KernelError(
          'The loft runs into itself between two sections. Check the order of the sections, and that they lie apart.',
        );
      default:
        throw new KernelError(
          "Couldn't loft through these sections. Check their order, and that no two lie in one plane.",
        );
    }
  }
}
