/**
 * The Mirror feature (P3-06, ADR-0044, FR-FT-11): mirrors bodies about a
 * plane (an origin plane, a construction plane or a flat face). By default
 * (`copy`, on) the originals stay and the mirrored copies are new bodies
 * (`<feature>:<n>`); with `copy` off the bodies themselves are mirrored and
 * keep their IDs. With `join` (only with `copy`), each copy is fused into
 * its original, which becomes one body: a symmetric part from half of it.
 *
 * Mirroring features (replaying them about the plane) is not part of this
 * feature: it takes bodies only (ADR-0044, patterns of features are P3-07).
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `MIRROR_TYPE` (ADR-0003).
 */
import { z } from 'zod';
import { refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { PLACEMENT_KINDS } from './primitives';
import { BoolInputSchema, type GeomRef } from './schema';

export const MIRROR_TYPE = 'mirror';

/** What a mirror can reflect in: an origin or construction plane, or a flat face. */
export const MIRROR_PLANE_KINDS = PLACEMENT_KINDS;

export const MirrorInputsSchema = z.strictObject({
  /** The bodies to mirror (`body` references). Empty: the feature fails until some are picked. */
  bodies: refsOf(['body']),
  /** The mirror plane. Empty: the feature fails until one is picked. */
  plane: refsOf(MIRROR_PLANE_KINDS, 1),
  /** Keep the originals and add mirrored copies. Default true. */
  copy: BoolInputSchema.optional(),
  /** Fuse each copy into its original (with `copy`). Default false. */
  join: BoolInputSchema.optional(),
});
export type MirrorInputs = z.infer<typeof MirrorInputsSchema>;

export const mirrorFeature: FeatureDefinition<MirrorInputs> = {
  type: MIRROR_TYPE,
  label: 'Mirror',
  category: 'modify',
  icon: 'mirror',
  inputsSchema: MirrorInputsSchema,
};

/** A mirror's inputs with every default filled in: what the kernel builds. */
export interface MirrorSettings {
  /** Body references, each once. */
  bodies: GeomRef[];
  plane: GeomRef | undefined;
  copy: boolean;
  /** Only with `copy`. */
  join: boolean;
}

/** Reads a mirror's (valid) inputs with their defaults. */
export function mirrorSettings(inputs: MirrorInputs): MirrorSettings {
  const seen = new Set<string>();
  const copy = inputs.copy?.value ?? true;
  return {
    bodies: inputs.bodies.refs.filter((ref) => !seen.has(ref.id) && seen.add(ref.id)),
    plane: inputs.plane.refs[0],
    copy,
    join: copy && (inputs.join?.value ?? false),
  };
}

export interface MirrorInputOptions {
  copy?: boolean;
  join?: boolean;
}

/** A mirror's inputs from body IDs and a plane (tests, scripts; the dialog builds the same shape). */
export function mirrorInputs(
  bodies: readonly string[],
  plane: GeomRef,
  options: MirrorInputOptions = {},
): MirrorInputs {
  const inputs: MirrorInputs = {
    bodies: { kind: 'ref', refs: bodies.map((id): GeomRef => ({ kind: 'body', id })) },
    plane: { kind: 'ref', refs: [plane] },
  };
  if (options.copy !== undefined) inputs.copy = { kind: 'bool', value: options.copy };
  if (options.join !== undefined) inputs.join = { kind: 'bool', value: options.join };
  return inputs;
}
