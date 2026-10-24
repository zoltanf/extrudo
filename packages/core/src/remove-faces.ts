/**
 * The Remove Faces feature (ADR-0099, #78): takes faces out of a solid and
 * extends or trims their neighbours until they meet, so a hole closes up
 * and a round becomes a sharp edge again (defeaturing). It works on any
 * body, imported ones too, which have no fillet or hole feature to delete.
 * All or nothing: when the gap of one picked face can't be closed, nothing
 * is removed and the kernel says which faces to add.
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `REMOVE_FACES_TYPE` (ADR-0003). The one input is a plain
 * `ref` input, so the document schema doesn't change.
 */
import type { RefInputMeta } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { FeatureId } from './ids';
import { type Feature, type GeomRef, type RefInput, RefInputSchema } from './schema';
import { z } from './zod';

export const REMOVE_FACES_TYPE = 'removeFaces';

/** What a removal takes: faces of bodies. */
export const REMOVE_FACES_KINDS = ['face'] as const;

export const RemoveFacesInputsSchema = z.strictObject({
  /** The faces to remove, of one or several bodies. At least one. */
  faces: RefInputSchema.refine(
    (input) => input.refs.length > 0 && input.refs.every((ref) => ref.kind === 'face'),
    'must be one or more face references',
  )
    .meta({ input: { kind: 'ref', kinds: REMOVE_FACES_KINDS } satisfies RefInputMeta })
    .describe(
      'The faces to remove; their neighbours are extended to close the gap. A round or a hole needs all its faces. Required.',
    ),
});
export type RemoveFacesInputs = z.infer<typeof RemoveFacesInputsSchema>;

export const removeFacesFeature: FeatureDefinition<RemoveFacesInputs> = {
  type: REMOVE_FACES_TYPE,
  label: 'Remove Faces',
  category: 'modify',
  icon: 'remove-faces',
  inputsSchema: RemoveFacesInputsSchema,
};

/** A removal's inputs from plain face references (tests, scripts; the dialog builds the same shape). */
export function removeFacesInputs(faces: readonly GeomRef[]): RemoveFacesInputs {
  const refs: RefInput = { kind: 'ref', refs: [...faces] };
  return { faces: refs };
}

/** A Remove Faces feature taking `faces` out. The caller makes the ID and the name. */
export function removeFacesFeatureOf(
  id: FeatureId,
  name: string,
  faces: readonly GeomRef[],
): Feature {
  return {
    id,
    type: REMOVE_FACES_TYPE,
    name,
    suppressed: false,
    inputs: removeFacesInputs(faces),
  };
}
