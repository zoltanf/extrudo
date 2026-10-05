/**
 * The Mirror feature (P3-06, ADR-0044, FR-FT-11): mirrors bodies about a
 * plane (an origin plane, a construction plane or a flat face). By default
 * (`copy`, on) the originals stay and the mirrored copies are new bodies
 * (`<feature>:<n>`); with `copy` off the bodies themselves are mirrored and
 * keep their IDs. With `join` (only with `copy`), each copy is fused into
 * its original, which becomes one body: a symmetric part from half of it.
 *
 * With `objects` = `features` (P3-07, ADR-0047) it mirrors *features*
 * instead: the tool of each chosen solid feature (extrude, revolve, a
 * primitive) is reflected in the plane and joined or cut like the feature
 * did, so a hole or boss made on one side appears on the other. Bodies are
 * ignored then, and `copy` and `join` don't apply. The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `MIRROR_TYPE` (ADR-0003).
 */

import { KEEPS_FACE_ROLES } from './face-roles';
import { enumInput, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { PATTERN_OBJECTS, type PatternObjects } from './pattern';
import { PLACEMENT_KINDS } from './primitives';
import { BoolInputSchema, type GeomRef } from './schema';
import { z } from './zod';

export const MIRROR_TYPE = 'mirror';

/** What a mirror can reflect in: an origin or construction plane, or a flat face. */
export const MIRROR_PLANE_KINDS = PLACEMENT_KINDS;

export const MirrorInputsSchema = z.strictObject({
  /** Default `bodies`; `features` mirrors the tools of `features` instead (P3-07). */
  objects: enumInput(PATTERN_OBJECTS)
    .optional()
    .describe('Mirror bodies, or replay the tools of features. Default bodies.'),
  /** The bodies to mirror (`body` references). Empty: the feature fails until some are picked. */
  bodies: refsOf(['body']).optional().describe('The bodies to mirror.'),
  /** `features`: the features whose tools are mirrored (`feature` references, feature IDs). */
  features: refsOf(['feature'])
    .optional()
    .describe('The features whose tools are mirrored, with objects: features.'),
  /** The mirror plane. Empty: the feature fails until one is picked. */
  plane: refsOf(MIRROR_PLANE_KINDS, 1).describe('The mirror plane. Required.'),
  /** Keep the originals and add mirrored copies. Default true. */
  copy: BoolInputSchema.optional().describe(
    'Keep the originals and add mirrored copies. Default true.',
  ),
  /** Fuse each copy into its original (with `copy`). Default false. */
  join: BoolInputSchema.optional().describe(
    'Fuse each copy into its original (with copy). Default false.',
  ),
});
export type MirrorInputs = z.infer<typeof MirrorInputsSchema>;

export const mirrorFeature: FeatureDefinition<MirrorInputs> = {
  type: MIRROR_TYPE,
  label: 'Mirror',
  category: 'modify',
  icon: 'mirror',
  inputsSchema: MirrorInputsSchema,
  // ADR-0068 §4: the mirrored bodies keep the names they had (P3-06, ADR-0044).
  faceRoles: KEEPS_FACE_ROLES,
};

/** A mirror's inputs with every default filled in: what the kernel builds. */
export interface MirrorSettings {
  objects: PatternObjects;
  /** Body references, each once. */
  bodies: GeomRef[];
  /** Feature references, each once (`objects` = `features`). */
  features: GeomRef[];
  plane: GeomRef | undefined;
  copy: boolean;
  /** Only with `copy`. */
  join: boolean;
}

/** Reads a mirror's (valid) inputs with their defaults. */
export function mirrorSettings(inputs: MirrorInputs): MirrorSettings {
  const seen = new Set<string>();
  const copy = inputs.copy?.value ?? true;
  const features = new Set<string>();
  return {
    objects: inputs.objects?.value ?? 'bodies',
    bodies: (inputs.bodies?.refs ?? []).filter((ref) => !seen.has(ref.id) && seen.add(ref.id)),
    features: (inputs.features?.refs ?? []).filter(
      (ref) => !features.has(ref.id) && features.add(ref.id),
    ),
    plane: inputs.plane.refs[0],
    copy,
    join: copy && (inputs.join?.value ?? false),
  };
}

export interface MirrorInputOptions {
  copy?: boolean;
  join?: boolean;
  /** Feature IDs whose tools are mirrored: makes `objects` `features` (the bodies may be empty). */
  features?: readonly string[];
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
  if (options.features) {
    inputs.objects = { kind: 'enum', value: 'features' };
    inputs.features = {
      kind: 'ref',
      refs: options.features.map((id): GeomRef => ({ kind: 'feature', id })),
    };
  }
  return inputs;
}
