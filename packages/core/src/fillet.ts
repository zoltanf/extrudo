/**
 * The fillet feature (P3-01, ADR-0038, FR-FT-04): rounds edges of a body
 * with a constant radius. The kernel adds its evaluator and the web app its
 * dialog, each in its own registry keyed by `FILLET_TYPE` (ADR-0003).
 *
 * **Edge sets.** A fillet has up to `FILLET_MAX_SETS` sets of edges, each
 * with its own radius: set 1 is `edges` + `radius`, set `n` is `edges<n>` +
 * `radius<n>` (`edges2`, `radius2` …). Every input is optional; a set
 * without edges is ignored, one with edges needs its radius. The inputs are
 * plain `ref` and `expr` inputs, so the document schema is unchanged.
 *
 * **Variable radius (P4-10, ADR-0064).** A set with a `radiusEnd<n>` is
 * **variable**: the radius runs from `radius<n>` at the start of the set's
 * tangent chain to `radiusEnd<n>` at its end. Which end that is depends on
 * the topology (OCCT's own order of the chain), so `swap<n>` exchanges them.
 * Without `radiusEnd<n>` the fillet is constant, as it always was.
 *
 * **Tangent chains.** OCCT rounds the whole chain of tangent-continuous
 * edges once one of them is given, with one radius. A dialog therefore adds
 * the chain of an edge you pick, and two sets that reach one chain with
 * different radii fail with a message (`mixed-radii`).
 */
import { exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { type BoolInput, BoolInputSchema, type GeomRef, type Input } from './schema';
import { z } from './zod';

export const FILLET_TYPE = 'fillet';

/** How many edge sets a fillet can have. */
export const FILLET_MAX_SETS = 8;

/** The input holding set `n`'s (1-based) edges: `edges`, `edges2`, … */
export const filletEdgesKey = (n: number) => (n === 1 ? 'edges' : `edges${n}`);
/** The input holding set `n`'s radius: `radius`, `radius2`, … */
export const filletRadiusKey = (n: number) => (n === 1 ? 'radius' : `radius${n}`);
/** The input holding set `n`'s radius at the other end: `radiusEnd`, `radiusEnd2`, … */
export const filletEndKey = (n: number) => (n === 1 ? 'radiusEnd' : `radiusEnd${n}`);
/** The input holding set `n`'s end swap: `swap`, `swap2`, … */
export const filletSwapKey = (n: number) => (n === 1 ? 'swap' : `swap${n}`);

/** The kinds of reference a fillet takes: edges of bodies. */
export const FILLET_EDGE_KINDS = ['edge'] as const;

const shape: Record<string, z.ZodType> = {};
for (let n = 1; n <= FILLET_MAX_SETS; n++) {
  const set = n === 1 ? 'Set 1' : `Set ${n}`;
  shape[filletEdgesKey(n)] = refsOf(FILLET_EDGE_KINDS)
    .optional()
    .describe(`${set}'s edges to round. A set with no edges does nothing.`);
  shape[filletRadiusKey(n)] = exprOf('length')
    .optional()
    .describe(`${set}'s radius; a length. Radius 0 leaves the edges as they are.`);
  shape[filletEndKey(n)] = exprOf('length')
    .optional()
    .describe(
      `${set}'s radius at the other end of each edge's tangent chain; a length. With one, the round tapers along the chain.`,
    );
  shape[filletSwapKey(n)] = BoolInputSchema.optional().describe(
    `${set}'s radius runs from the chain's other end. Default false.`,
  );
}

/** A fillet's inputs: `edges`/`radius`, `edges2`/`radius2` … (all optional). */
export type FilletInputs = Record<string, Input>;

export const FilletInputsSchema = z.strictObject(shape) as unknown as z.ZodType<FilletInputs>;

export const filletFeature: FeatureDefinition<FilletInputs> = {
  type: FILLET_TYPE,
  label: 'Fillet',
  category: 'modify',
  icon: 'fillet',
  inputsSchema: FilletInputsSchema,
  // ADR-0068 §4, from the kernel's fillet (P3-01): the round an edge makes.
  faceRoles: [
    {
      pattern: 'from:(<edge>)',
      description: 'The round: a face the fillet makes from each edge it rounds.',
    },
  ],
};

/** One set of a fillet: its edges and the inputs holding its radii. */
export interface FilletSet {
  /** 1-based. */
  n: number;
  edges: GeomRef[];
  /** The `expr` input's name, absent while the set has none. */
  radius: string | undefined;
  /** The `expr` input with the radius at the chain's other end, absent while constant. */
  radiusEnd: string | undefined;
  /** Whether the two radii are the other way round. */
  swap: boolean;
}

/** The sets of a fillet that have edges, in order. */
export function filletSets(inputs: FilletInputs): FilletSet[] {
  const sets: FilletSet[] = [];
  for (let n = 1; n <= FILLET_MAX_SETS; n++) {
    const edges = inputs[filletEdgesKey(n)];
    if (edges?.kind !== 'ref' || edges.refs.length === 0) continue;
    const radius = filletRadiusKey(n);
    const radiusEnd = filletEndKey(n);
    sets.push({
      n,
      edges: edges.refs,
      radius: inputs[radius]?.kind === 'expr' ? radius : undefined,
      radiusEnd: inputs[radiusEnd]?.kind === 'expr' ? radiusEnd : undefined,
      swap: (inputs[filletSwapKey(n)] as BoolInput | undefined)?.value === true,
    });
  }
  return sets;
}

/**
 * A fillet's inputs from plain sets (tests, scripts, templates; the dialog
 * builds the same shape). Radii get the length unit; `paramName`s are left
 * to the caller. A set with `radiusEnd` is variable, and `swap` exchanges its
 * two ends.
 */
export function filletInputs(
  sets: readonly {
    edges: GeomRef[];
    radius: string;
    radiusEnd?: string;
    swap?: boolean;
  }[],
): FilletInputs {
  const inputs: FilletInputs = {};
  sets.slice(0, FILLET_MAX_SETS).forEach(({ edges, radius, radiusEnd, swap }, i) => {
    inputs[filletEdgesKey(i + 1)] = { kind: 'ref', refs: edges };
    inputs[filletRadiusKey(i + 1)] = { kind: 'expr', expr: radius, unit: 'length' };
    if (radiusEnd === undefined) return;
    inputs[filletEndKey(i + 1)] = { kind: 'expr', expr: radiusEnd, unit: 'length' };
    if (swap === true) inputs[filletSwapKey(i + 1)] = { kind: 'bool', value: true };
  });
  return inputs;
}

/** Whether any set of this fillet has an end radius, so it needs the tapered build. */
export function filletIsVariable(inputs: FilletInputs): boolean {
  return filletSets(inputs).some((set) => set.radiusEnd !== undefined);
}
