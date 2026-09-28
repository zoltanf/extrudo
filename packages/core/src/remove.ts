/**
 * The Remove feature (P2-08, ADR-0030): deleting a body is a timeline step,
 * not a document edit, because the body is derived: the features that made
 * it stay, and a Remove after them takes it out of the body set. Rolling
 * the timeline back past it, suppressing or deleting it brings the body
 * back. The kernel adds its evaluator, keyed by `REMOVE_TYPE` (ADR-0003).
 */
import { z } from 'zod';
import type { FeatureDefinition } from './features';
import type { BodyId, FeatureId } from './ids';
import { type Feature, type GeomRef, RefInputSchema } from './schema';

export const REMOVE_TYPE = 'remove';

export const RemoveInputsSchema = z.strictObject({
  /** The bodies to remove (`body` references: body IDs). At least one. */
  bodies: RefInputSchema.refine(
    (input) => input.refs.length > 0 && input.refs.every((ref) => ref.kind === 'body'),
    'must be one or more body references',
  ),
});
export type RemoveInputs = z.infer<typeof RemoveInputsSchema>;

export const removeBodiesFeature: FeatureDefinition<RemoveInputs> = {
  type: REMOVE_TYPE,
  label: 'Remove',
  category: 'modify',
  icon: 'remove',
  inputsSchema: RemoveInputsSchema,
};

/** A Remove feature taking `bodies` out of the model. The caller makes the ID and the name. */
export function removeBodiesFeatureOf(
  id: FeatureId,
  name: string,
  bodies: readonly BodyId[],
): Feature {
  const refs: GeomRef[] = [...new Set(bodies)].map((body) => ({ kind: 'body', id: body }));
  return {
    id,
    type: REMOVE_TYPE,
    name,
    suppressed: false,
    inputs: { bodies: { kind: 'ref', refs } },
  };
}

/** The body IDs a Remove feature takes out (none for another feature). */
export function removedBodies(feature: Pick<Feature, 'type' | 'inputs'>): BodyId[] {
  if (feature.type !== REMOVE_TYPE) return [];
  const input = feature.inputs.bodies;
  return input?.kind === 'ref' ? input.refs.map((ref) => ref.id as BodyId) : [];
}
