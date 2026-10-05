/**
 * The Split Body feature (P3-08, FR-FT-12): cuts bodies in two along a
 * plane (an origin plane, a construction plane, or a flat face, which is
 * taken as its whole plane, so a face of one body can split another). Each
 * side becomes a body of its own; a side that falls apart into several
 * solids becomes several bodies. The largest piece keeps the body's ID and
 * name, the others get the feature's `<feature>:<n>` IDs (ADR-0030).
 * `keep` can drop one side: `above` keeps the side the plane's normal
 * points to (for the XY plane, z > 0), `below` the other.
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `SPLIT_BODY_TYPE` (ADR-0003). Inputs are plain `ref` and
 * `enum` inputs, so the document schema doesn't change.
 */
import { enumInput, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { PLACEMENT_KINDS } from './primitives';
import type { GeomRef, RefInput } from './schema';
import { z } from './zod';

export const SPLIT_BODY_TYPE = 'splitBody';

/** What a body is split by: an origin or construction plane, or a flat face (its plane). */
export const SPLIT_TOOL_KINDS = PLACEMENT_KINDS;

/** Which sides stay: both, or the one above (along the plane's normal) or below the plane. */
export const SPLIT_KEEP = ['both', 'above', 'below'] as const;
export type SplitKeep = (typeof SPLIT_KEEP)[number];

export const SplitBodyInputsSchema = z.strictObject({
  /** The bodies to split. Empty: the feature fails until some are picked. */
  bodies: refsOf(['body']).describe('The bodies to split. Required.'),
  /** The splitting plane. Empty: the feature fails until one is picked. */
  plane: refsOf(SPLIT_TOOL_KINDS, 1).describe('The plane to split them on. Required.'),
  /** Default `both`. */
  keep: enumInput(SPLIT_KEEP)
    .optional()
    .describe('Keep both sides, the one above the plane or the one below. Default both.'),
});
export type SplitBodyInputs = z.infer<typeof SplitBodyInputsSchema>;

export const splitBodyFeature: FeatureDefinition<SplitBodyInputs> = {
  type: SPLIT_BODY_TYPE,
  label: 'Split Body',
  category: 'modify',
  icon: 'split-body',
  inputsSchema: SplitBodyInputsSchema,
  // ADR-0068 §4, from the kernel's split (P3-08): the faces the plane cut, and
  // the two sides each carry one.
  faceRoles: [
    {
      pattern: 'cut:above',
      description: 'The face the plane cut on the part above it, facing down the normal.',
    },
    {
      pattern: 'cut:below',
      description: 'The face the plane cut on the part below it, facing up the normal.',
    },
  ],
};

/** A split's inputs with every default filled in: what the kernel builds. */
export interface SplitBodySettings {
  /** Body references, each once. */
  bodies: GeomRef[];
  plane: GeomRef | undefined;
  keep: SplitKeep;
}

/** Reads a split's (valid) inputs with their defaults. */
export function splitBodySettings(inputs: SplitBodyInputs): SplitBodySettings {
  const seen = new Set<string>();
  return {
    bodies: inputs.bodies.refs.filter((ref) => !seen.has(ref.id) && seen.add(ref.id)),
    plane: inputs.plane.refs[0],
    keep: inputs.keep?.value ?? 'both',
  };
}

/** A split's inputs from body IDs, a plane and the side to keep (tests, scripts; the dialog builds the same shape). */
export function splitBodyInputs(
  bodies: readonly string[],
  plane: GeomRef | undefined,
  keep?: SplitKeep,
): SplitBodyInputs {
  const refs: RefInput = { kind: 'ref', refs: bodies.map((id): GeomRef => ({ kind: 'body', id })) };
  const inputs: SplitBodyInputs = {
    bodies: refs,
    plane: { kind: 'ref', refs: plane ? [plane] : [] },
  };
  if (keep) inputs.keep = { kind: 'enum', value: keep };
  return inputs;
}
