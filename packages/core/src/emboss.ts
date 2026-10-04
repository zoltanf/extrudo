/**
 * The emboss feature (P4-04, ADR-0060, FR-FT-16): puts sketch profiles or
 * text **onto** a face of a body and joins them on (emboss, they stand out)
 * or cuts them in (deboss, they go into the surface). The kernel adds its
 * evaluator and the web app its dialog, each in its own registry keyed by
 * `EMBOSS_TYPE` (ADR-0003).
 *
 * One feature for both, with a `mode`: an emboss joins material outwards and a
 * deboss cuts inwards, like extrude's operation. The target body is the body
 * that owns `face`; nothing else is touched.
 *
 * Every input except `profiles` and `face` is optional and has a default, so
 * a minimal emboss is `{ profiles, face }`: 1 mm, embossed.
 */
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { ExprInput, GeomRef, GeomRefKind, RefInput, UnitKind } from './schema';
import { z } from './zod';

export const EMBOSS_TYPE = 'emboss';

/**
 * What can be embossed: sketch profiles (`<sketch>/<region>`) and whole texts
 * (`<sketch>/<text>`, P4-03, ADR-0058 §5: every ink region of the text, so it
 * survives editing the string).
 */
export const EMBOSS_PROFILE_KINDS: readonly GeomRefKind[] = ['profile', 'sketchEntity'];
/** The face to emboss on: one flat face of a body (cylindrical faces come with P4-04's later slices). */
export const EMBOSS_FACE_KINDS: readonly GeomRefKind[] = ['face'];

/** `emboss` joins material outwards; `deboss` cuts it inwards. */
export const EMBOSS_MODES = ['emboss', 'deboss'] as const;
export type EmbossMode = (typeof EMBOSS_MODES)[number];

/** The depth an emboss has without a `depth` input, in mm (the dialog's default). */
export const EMBOSS_DEFAULT_DEPTH = 1;

export const EmbossInputsSchema = z.strictObject({
  /** The profiles and whole texts to emboss, all in one plane. Missing or empty: the feature fails until some are picked. */
  profiles: refsOf(EMBOSS_PROFILE_KINDS).optional(),
  /** The face to emboss on: the body that owns it is the only body touched. */
  face: refsOf(EMBOSS_FACE_KINDS, 1).optional(),
  /** How far the letters stand out or go in; must be greater than 0. */
  depth: exprOf('length').optional(),
  /** Default `emboss`. */
  mode: enumInput(EMBOSS_MODES).optional(),
});
export type EmbossInputs = z.infer<typeof EmbossInputsSchema>;

export const embossFeature: FeatureDefinition<EmbossInputs> = {
  type: EMBOSS_TYPE,
  label: 'Emboss',
  category: 'create',
  icon: 'emboss',
  inputsSchema: EmbossInputsSchema,
};

/** An emboss's inputs with every default filled in: what the kernel builds. */
export interface EmbossSettings {
  profiles: GeomRef[];
  /** The face to emboss on, if there is one. */
  face?: GeomRef;
  /** The `expr` input holding the depth, if there is one (else `EMBOSS_DEFAULT_DEPTH`). */
  depth?: 'depth';
  mode: EmbossMode;
}

/** Reads an emboss's (valid) inputs with their defaults. */
export function embossSettings(inputs: EmbossInputs): EmbossSettings {
  const face = inputs.face?.refs[0];
  return {
    profiles: inputs.profiles?.refs ?? [],
    ...(face ? { face } : {}),
    ...(inputs.depth ? { depth: 'depth' as const } : {}),
    mode: inputs.mode?.value ?? 'emboss',
  };
}

export interface EmbossInputOptions {
  depth?: string;
  mode?: EmbossMode;
}

/**
 * An emboss's inputs from plain options (tests, scripts; the dialog builds
 * the same shape). Expressions get their unit; `paramName`s are left to the
 * caller, as for any feature.
 */
export function embossInputs(
  profiles: GeomRef[],
  face: GeomRef,
  options: EmbossInputOptions = {},
): EmbossInputs {
  const expr = (value: string, unit: UnitKind): ExprInput => ({ kind: 'expr', expr: value, unit });
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: EmbossInputs = { profiles: refs(profiles), face: refs([face]) };
  if (options.depth !== undefined) inputs.depth = expr(options.depth, 'length');
  if (options.mode) inputs.mode = { kind: 'enum', value: options.mode };
  return inputs;
}
