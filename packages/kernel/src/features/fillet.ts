import { type BodyId, type FilletInputs, filletFeature, filletSets } from '@extrudo/core';
import { FilletError, type FilletProblem, KernelError, type ShapeHandle } from '../kernel';
import type { TopoNames } from '../naming/names';
import { type NamedShape, withHistory } from '../naming/ops';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';

/**
 * The fillet feature in the kernel (P3-01, ADR-0038): rounds the picked
 * edges, each set with its own constant radius. Edges are resolved by name
 * (ADR-0005), so a fillet follows its edges through earlier edits and a
 * lost one is a `LostReferenceError` (Fix References). Edges of several
 * bodies fillet each body on its own. The fillet faces are named
 * `fillet:<id>:from:(<edge name>)`, so later features can refer to them and
 * they keep their names when a radius changes.
 *
 * A failure is turned into a message a person can act on (FR-UX-06): which
 * edge, and the largest radius that works ("radius too large for edge 12,
 * max ≈ 2.4 mm"). The kernel finds that number (facade `fillet`).
 */
export const kernelFillet: KernelFeatureDefinition<FilletInputs> = {
  ...filletFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateFillet,
};

/** One edge to round: where it is and with what radius. */
interface EdgePick {
  index: number;
  radius: number;
  /** The set it came from (1-based), for messages. */
  set: number;
}

function evaluateFillet(ctx: EvalContext<FilletInputs>): FeatureOutput {
  const { kernel } = ctx;
  const sets = filletSets(ctx.inputs);
  if (sets.length === 0) throw new KernelError('Pick at least one edge to fillet.');

  // Edges by body, each with its set's radius.
  const byBody = new Map<BodyId, EdgePick[]>();
  for (const set of sets) {
    if (set.radius === undefined) {
      throw new KernelError(`Enter a radius for edge set ${set.n}.`);
    }
    const radius = ctx.value(set.radius);
    if (!(radius > 0)) {
      throw new KernelError(
        `The radius of edge set ${set.n} is ${formatLength(radius)}. Enter a radius greater than 0.`,
      );
    }
    for (const ref of set.edges) {
      const hit = ctx.resolve(ref, { label: 'an edge to fillet' });
      const picks = byBody.get(hit.body) ?? [];
      const same = picks.find((p) => p.index === hit.index);
      if (same) {
        if (Math.abs(same.radius - radius) > 1e-9) {
          throw new KernelError(
            `Edge ${hit.index + 1} is in edge sets ${same.set} and ${set.n} with different radii. Keep it in one set.`,
          );
        }
        continue;
      }
      picks.push({ index: hit.index, radius, set: set.n });
      byBody.set(hit.body, picks);
    }
  }

  using scope = kernel.scope();
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  const made = new Map<BodyId, NamedShape>();
  for (const [body, picks] of byBody) {
    const shape = ctx.bodies.get(body) as ShapeHandle;
    let result: ReturnType<typeof kernel.fillet>;
    try {
      result = kernel.fillet(
        shape,
        picks.map((p) => p.index),
        picks.map((p) => p.radius),
      );
    } catch (error) {
      if (error instanceof FilletError) throw new KernelError(filletMessage(error, picks));
      throw error;
    }
    scope.track(result);
    const named = withHistory(kernel, result, [ctx.names(body)], {
      op: 'fillet',
      feature: ctx.feature.id,
    });
    made.set(body, named);
  }
  // Kept only when every body worked: a failure releases them all with the scope.
  for (const [body, named] of made) {
    bodies.set(body, scope.keep(named.shape));
    names.set(body, named.names);
  }
  return { bodies, names };
}

// ----------------------------------------------------------------- messages

/**
 * A fillet failure as a message (FR-UX-06): one sentence per problem, edges
 * counted from 1 as the app's selection lists them ("Edge 12"), radii in mm.
 */
export function filletMessage(error: FilletError, picks: readonly EdgePick[]): string {
  const edgeOf = (edges: readonly number[]) => {
    const picked = edges.find((e) => picks.some((p) => p.index === e)) ?? edges[0] ?? 0;
    return picked + 1;
  };
  const radiusOf = (edges: readonly number[]) =>
    picks.find((p) => edges.includes(p.index))?.radius ?? picks[0]?.radius ?? 0;
  const sentences = error.problems.map((problem) =>
    problemMessage(problem, edgeOf, radiusOf, picks),
  );
  return [...new Set(sentences)].join(' ');
}

function problemMessage(
  problem: FilletProblem,
  edgeOf: (edges: readonly number[]) => number,
  radiusOf: (edges: readonly number[]) => number,
  picks: readonly EdgePick[],
): string {
  switch (problem.kind) {
    case 'too-large': {
      const edge = edgeOf(problem.edges);
      const radius = formatLength(radiusOf(problem.edges));
      return problem.max > 0
        ? `Radius ${radius} is too large for edge ${edge} (max ≈ ${formatLength(floorTo2(problem.max))}).`
        : `Edge ${edge} can't be rounded with radius ${radius}, or with any smaller one. Pick other edges, or check the faces around it.`;
    }
    case 'unfilletable':
      return `Edge ${edgeOf(problem.edges)} can't be filleted: it isn't between two faces of the body.`;
    case 'mixed-radii': {
      const list = problem.edges.filter((e) => picks.some((p) => p.index === e)).map((e) => e + 1);
      return `Edges ${listOf(list)} are one chain of tangent edges, so they take one radius. Give them the same radius, or keep them in one set.`;
    }
    case 'together': {
      const largest = Math.max(...picks.map((p) => p.radius));
      return `These fillets can't all be built where they meet. ${
        problem.factor > 0
          ? `Try radii up to about ${formatLength(floorTo2(problem.factor * largest))}, or `
          : 'Try '
      }fewer edges at once.`;
    }
    case 'other':
      return "The fillet couldn't be built. Try a smaller radius or other edges.";
  }
}

/** Rounds down to two significant digits, so the number given still works. */
function floorTo2(value: number): number {
  if (!(value > 0)) return 0;
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.floor(value / step + 1e-9) * step;
}

/** "2.4 mm", "10 mm", "0.35 mm": at most three decimals, no trailing zeros. */
function formatLength(value: number): string {
  const text = Number.parseFloat(value.toFixed(3)).toString();
  return `${text} mm`;
}

/** "3", "3 and 8", "3, 8 and 12". */
function listOf(numbers: readonly number[]): string {
  if (numbers.length < 2) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}
