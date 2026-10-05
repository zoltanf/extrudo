/**
 * The rib feature (P4-10, ADR-0064 §1, FR-FT-17): a thin wall (a gusset, a
 * web) that fills the space between one sketch **line** and the bodies beside
 * it. The line is the rib's open edge — in an L-bracket a diagonal on the
 * bracket's middle plane — and the material runs from it until it meets the
 * body, with a thickness about the sketch plane and a side to grow on.
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `RIB_TYPE` (ADR-0003).
 *
 * Only `curve` is required, so a minimal rib is `{ curve }`: a 2 mm wall
 * centred on the sketch plane, growing to the side of the line where the body
 * is. The rest are optional with defaults, like extrude's (ADR-0028).
 */

import { SWEEP_FACE_ROLES } from './face-roles';
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
} from './schema';
import { z } from './zod';

export const RIB_TYPE = 'rib';

/**
 * What a rib's open edge is: one sketch **line** (`<sketch>/<line>`, as
 * revolve's axis takes one — ADR-0029). Arcs and splines come with the
 * chain-of-curves slice of ADR-0064.
 */
export const RIB_CURVE_KINDS: readonly GeomRefKind[] = ['sketchEntity'];

/** The rib's default thickness in mm (what the dialog offers). */
export const RIB_DEFAULT_THICKNESS = 2;

/**
 * Where the thickness sits about the sketch plane: centred on it (`both`),
 * from it along its normal (`one`) or against it (`other`).
 */
export const RIB_SIDES = ['both', 'one', 'other'] as const;
export type RibSide = (typeof RIB_SIDES)[number];

export const RibInputsSchema = z.strictObject({
  /** The line the rib grows from, in world mm. Missing: the feature fails until one is picked. */
  curve: refsOf(RIB_CURVE_KINDS, 1).optional().describe('The sketch line the rib grows from.'),
  /** How thick the wall is; must be greater than 0. Default 2 mm. */
  thickness: exprOf('length')
    .optional()
    .describe('How thick the wall is; a length greater than 0. Default 2 mm.'),
  /** Default `both`: centred on the sketch plane. */
  side: enumInput(RIB_SIDES)
    .optional()
    .describe(
      'Which side of the line the wall grows on, or centred on the sketch plane. Default both.',
    ),
  /** Grow to the other side of the line. Default false. */
  flip: BoolInputSchema.optional().describe('Grow to the other side of the line. Default false.'),
});
export type RibInputs = z.infer<typeof RibInputsSchema>;

export const ribFeature: FeatureDefinition<RibInputs> = {
  type: RIB_TYPE,
  label: 'Rib',
  category: 'create',
  icon: 'rib',
  inputsSchema: RibInputsSchema,
  // ADR-0068 §4, from the kernel's rib (P4-10): the face on the line, the far
  // one, a wall per side of the line, and the slab's own two ends.
  faceRoles: [
    ...SWEEP_FACE_ROLES,
    {
      pattern: 'side:<line>:end0',
      description:
        'The wall at the first end of the line, where the slab was extended to reach the body.',
    },
    {
      pattern: 'side:<line>:end1',
      description: 'The wall at the second end of the line, the other way round.',
    },
  ],
};

/** A rib's inputs with every default filled in: what the kernel builds. */
export interface RibSettings {
  /** The line to grow from, if one is picked. */
  curve?: GeomRef;
  /** The `expr` input holding the thickness, if there is one (else `RIB_DEFAULT_THICKNESS`). */
  thickness?: 'thickness';
  side: RibSide;
  flip: boolean;
}

/** Reads a rib's (valid) inputs with their defaults. */
export function ribSettings(inputs: RibInputs): RibSettings {
  const curve = inputs.curve?.refs[0];
  return {
    ...(curve ? { curve } : {}),
    ...(inputs.thickness ? { thickness: 'thickness' as const } : {}),
    side: inputs.side?.value ?? 'both',
    flip: inputs.flip?.value ?? false,
  };
}

export interface RibInputOptions {
  thickness?: string;
  side?: RibSide;
  flip?: boolean;
}

/**
 * A rib's inputs from plain options (tests, scripts; the dialog builds the
 * same shape). Expressions get their unit; `paramName`s are left to the
 * caller, as for any feature.
 */
export function ribInputs(curve: GeomRef, options: RibInputOptions = {}): RibInputs {
  const expr = (value: string): ExprInput => ({ kind: 'expr', expr: value, unit: 'length' });
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: RibInputs = { curve: refs([curve]) };
  const o = options;
  if (o.thickness !== undefined) inputs.thickness = expr(o.thickness);
  if (o.side) inputs.side = { kind: 'enum', value: o.side };
  if (o.flip !== undefined) inputs.flip = { kind: 'bool', value: o.flip };
  return inputs;
}
