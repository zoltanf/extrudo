import {
  type BodyId,
  type ChamferInputs,
  type ChamferSet,
  chamferFeature,
  chamferSets,
} from '@extrudo/core';
import {
  ChamferError,
  type ChamferProblem,
  type ChamferSpec,
  KernelError,
  type ShapeHandle,
} from '../kernel';
import type { TopoNames } from '../naming/names';
import { type NamedShape, withHistory } from '../naming/ops';
import type { ResolvedRef } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from '../recompute/types';

/**
 * The chamfer feature in the kernel (P3-02, ADR-0043): bevels the picked
 * edges, each set with its own mode (equal distance, two distances, distance
 * and angle) and values. Edges are resolved by name (ADR-0005), so a chamfer
 * follows its edges through earlier edits and a lost one is a
 * `LostReferenceError` (Fix References). Edges of several bodies are
 * chamfered body by body. The chamfer faces are named
 * `chamfer:<id>:from:(<edge name>)`, so later features can refer to them and
 * they keep their names when a distance changes.
 *
 * A failure is turned into a message a person can act on (FR-UX-06): which
 * edge, and the largest distance that works ("distance too large for edge
 * 12, max ≈ 2.4 mm"). The kernel finds that number (facade `chamfer`).
 *
 * **Reference face (P4-12).** A set of the two non-equal modes may name the
 * face that takes `distance` (`face`, `face2` …). The facade's own choice is
 * the lower-numbered of an edge's two faces in the body's face order, with
 * `flip` taking the other, so a picked face is turned into that `flip` here,
 * edge by edge, from the body's description (`Kernel.describe`). A face that
 * doesn't touch one of the set's edges is an error.
 */
export const kernelChamfer: KernelFeatureDefinition<ChamferInputs> = {
  ...chamferFeature,
  bodyAccess: () => 'write',
  evaluate: evaluateChamfer,
};

/** One edge to bevel: where it is and how. */
interface EdgePick {
  index: number;
  spec: ChamferSpec;
  /** The set it came from (1-based), for messages. */
  set: number;
}

function evaluateChamfer(ctx: EvalContext<ChamferInputs>): FeatureOutput {
  const { kernel } = ctx;
  const sets = chamferSets(ctx.inputs);
  if (sets.length === 0) throw new KernelError('Pick at least one edge to chamfer.');

  // Edges by body, each with its set's spec.
  const byBody = new Map<BodyId, EdgePick[]>();
  for (const set of sets) {
    const plain = specOf(ctx, set);
    // A set's reference face (P4-12) decides `flip` edge by edge; an equal
    // distance chamfer has no reference face at all.
    const face =
      set.face && plain.mode !== 'equal'
        ? ctx.resolve(set.face, { label: 'the chamfer’s reference face' })
        : undefined;
    for (const ref of set.edges) {
      const hit = ctx.resolve(ref, { label: 'an edge to chamfer' });
      const spec = face ? { ...plain, flip: flipAt(ctx, face, hit, set.n) } : plain;
      const picks = byBody.get(hit.body) ?? [];
      const same = picks.find((p) => p.index === hit.index);
      if (same) {
        if (!sameSpec(same.spec, spec)) {
          throw new KernelError(
            `Edge ${hit.index + 1} is in edge sets ${same.set} and ${set.n} with different settings. Keep it in one set.`,
          );
        }
        continue;
      }
      picks.push({ index: hit.index, spec, set: set.n });
      byBody.set(hit.body, picks);
    }
  }

  using scope = kernel.scope();
  const bodies = new Map(ctx.bodies);
  const names = new Map<BodyId, TopoNames>();
  const made = new Map<BodyId, NamedShape>();
  for (const [body, picks] of byBody) {
    const shape = ctx.bodies.get(body) as ShapeHandle;
    let result: ReturnType<typeof kernel.chamfer>;
    try {
      result = kernel.chamfer(
        shape,
        picks.map((p) => p.index),
        picks.map((p) => p.spec),
      );
    } catch (error) {
      if (error instanceof ChamferError) throw new KernelError(chamferMessage(error, picks));
      throw error;
    }
    scope.track(result);
    const named = withHistory(kernel, result, [ctx.names(body)], {
      op: 'chamfer',
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

/** A set's values as a `ChamferSpec` (angles in radians), or a message about what is missing. */
function specOf(ctx: EvalContext<ChamferInputs>, set: ChamferSet): ChamferSpec {
  const length = (input: string | undefined, what: string): number => {
    if (input === undefined) throw new KernelError(`Enter ${what} for edge set ${set.n}.`);
    const value = ctx.value(input);
    if (!(value > 0)) {
      throw new KernelError(
        `The ${what.replace(/^a /, '')} of edge set ${set.n} is ${formatLength(value)}. Enter one greater than 0.`,
      );
    }
    return value;
  };
  const distance = length(set.distance, 'a distance');
  switch (set.mode) {
    case 'equal':
      return { mode: 'equal', distance };
    case 'two-distances':
      return {
        mode: 'two-distances',
        distance,
        distanceB: length(set.distanceB, 'a second distance'),
        flip: set.flip,
      };
    case 'distance-angle': {
      if (set.angle === undefined) throw new KernelError(`Enter an angle for edge set ${set.n}.`);
      const degrees = ctx.value(set.angle);
      if (!(degrees > 0 && degrees < 90)) {
        throw new KernelError(
          `The angle of edge set ${set.n} is ${formatNumber(degrees)}°. Enter an angle between 0° and 90°.`,
        );
      }
      return { mode: 'distance-angle', distance, angle: (degrees * Math.PI) / 180, flip: set.flip };
    }
  }
}

const sameSpec = (a: ChamferSpec, b: ChamferSpec) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether the set's reference face is the other one of an edge's two faces
 * (P4-12): the facade's default reference face is the lower-numbered of them
 * in the body's face order, and `flip` takes the higher-numbered one, so the
 * picked face decides. The face must be one of the edge's own faces, else the
 * chamfer can't be built as asked.
 */
function flipAt(
  ctx: EvalContext<ChamferInputs>,
  face: ResolvedRef,
  edge: ResolvedRef,
  set: number,
): boolean {
  const around =
    face.body === edge.body ? (ctx.describe(edge.shape).edges[edge.index]?.faces ?? []) : [];
  if (!around.includes(face.index)) {
    throw new KernelError(
      `The reference face of edge set ${set} doesn't touch edge ${edge.index + 1}: pick a face next to every edge in the set.`,
    );
  }
  return face.index !== Math.min(...around);
}

// ----------------------------------------------------------------- messages

/**
 * A chamfer failure as a message (FR-UX-06): one sentence per problem, edges
 * counted from 1 as the app's selection lists them ("Edge 12"), distances
 * in mm.
 */
export function chamferMessage(error: ChamferError, picks: readonly EdgePick[]): string {
  const pickOf = (edges: readonly number[]) =>
    picks.find((p) => edges.includes(p.index)) ?? (picks[0] as EdgePick);
  const sentences = error.problems.map((problem) => problemMessage(problem, pickOf, picks));
  return [...new Set(sentences)].join(' ');
}

function problemMessage(
  problem: ChamferProblem,
  pickOf: (edges: readonly number[]) => EdgePick,
  picks: readonly EdgePick[],
): string {
  switch (problem.kind) {
    case 'too-large':
      return tooLarge(problem, pickOf(problem.edges));
    case 'unchamferable':
      return `Edge ${pickOf(problem.edges).index + 1} can't be chamfered: it isn't between two faces of the body.`;
    case 'mixed': {
      const list = problem.edges.filter((e) => picks.some((p) => p.index === e)).map((e) => e + 1);
      return `Edges ${listOf(list)} are one chain of tangent edges, so they take one setting. Give them the same values, or keep them in one set.`;
    }
    case 'together': {
      const largest = Math.max(...picks.map((p) => p.spec.distance));
      return `These chamfers can't all be built where they meet. ${
        problem.factor > 0
          ? `Try distances up to about ${formatLength(floorTo2(problem.factor * largest))}, or `
          : 'Try '
      }fewer edges at once.`;
    }
    case 'other':
      break;
  }
  return "The chamfer couldn't be built. Try smaller distances or other edges.";
}

/** "Distance 8 mm is too large for edge 12 (max ≈ 5.6 mm)": the maximum rounds down, so it works. */
function tooLarge(problem: Extract<ChamferProblem, { kind: 'too-large' }>, pick: EdgePick): string {
  const edge = pick.index + 1;
  const { spec } = pick;
  const max = (value: number) => formatLength(floorTo2(problem.factor * value));
  if (problem.factor <= 0) {
    return `Edge ${edge} can't be chamfered with ${describe(spec)}, or with anything smaller. Pick other edges, or check the faces around it.`;
  }
  switch (spec.mode) {
    case 'equal':
      return `Distance ${formatLength(spec.distance)} is too large for edge ${edge} (max ≈ ${max(spec.distance)}).`;
    case 'two-distances':
      return `Distances ${formatLength(spec.distance)} and ${formatLength(spec.distanceB)} are too large for edge ${edge}. Try up to ${max(spec.distance)} and ${max(spec.distanceB)}.`;
    case 'distance-angle':
      return `Distance ${formatLength(spec.distance)} at ${formatNumber(toDegrees(spec.angle))}° is too large for edge ${edge} (max ≈ ${max(spec.distance)}).`;
  }
}

/** "2 mm", "2 mm and 4 mm", "3 mm at 30°": a spec for a sentence. */
function describe(spec: ChamferSpec): string {
  switch (spec.mode) {
    case 'equal':
      return formatLength(spec.distance);
    case 'two-distances':
      return `${formatLength(spec.distance)} and ${formatLength(spec.distanceB)}`;
    case 'distance-angle':
      return `${formatLength(spec.distance)} at ${formatNumber(toDegrees(spec.angle))}°`;
  }
}

const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** Rounds down to two significant digits, so the number given still works. */
function floorTo2(value: number): number {
  if (!(value > 0)) return 0;
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.floor(value / step + 1e-9) * step;
}

/** "2.4", "10", "0.35": at most three decimals, no trailing zeros. */
function formatNumber(value: number): string {
  return Number.parseFloat(value.toFixed(3)).toString();
}

/** "2.4 mm". */
function formatLength(value: number): string {
  return `${formatNumber(value)} mm`;
}

/** "3", "3 and 8", "3, 8 and 12". */
function listOf(numbers: readonly number[]): string {
  if (numbers.length < 2) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}
