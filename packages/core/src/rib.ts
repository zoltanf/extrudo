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
import { z } from 'zod';
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
} from './schema';

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
  curve: refsOf(RIB_CURVE_KINDS, 1).optional(),
  /** How thick the wall is; must be greater than 0. Default 2 mm. */
  thickness: exprOf('length').optional(),
  /** Default `both`: centred on the sketch plane. */
  side: enumInput(RIB_SIDES).optional(),
  /** Grow to the other side of the line. Default false. */
  flip: BoolInputSchema.optional(),
});
export type RibInputs = z.infer<typeof RibInputsSchema>;

export const ribFeature: FeatureDefinition<RibInputs> = {
  type: RIB_TYPE,
  label: 'Rib',
  category: 'create',
  icon: 'rib',
  inputsSchema: RibInputsSchema,
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
