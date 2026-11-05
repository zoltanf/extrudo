/**
 * The emboss feature (P4-04, ADR-0060, FR-FT-16): puts sketch profiles or
 * text **onto** a face of a body and joins them on (emboss, they stand out)
 * or cuts them in (deboss, they go into the surface). The kernel adds its
 * evaluator and the web app its dialog, each in its own registry keyed by
 * `EMBOSS_TYPE` (ADR-0003).
 *
 * One feature for both, with a `mode`: an emboss joins material outwards and a
 * deboss cuts inwards, like extrude's operation. The target body is the body
 * that owns the picked faces (`face`, several of one body: P4-12); nothing
 * else is touched.
 *
 * Every input except `profiles` and `face` is optional and has a default, so
 * a minimal emboss is `{ profiles, face }`: 1 mm, embossed.
 */

import { type FaceRole, SWEEP_FACE_ROLES } from './face-roles';
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
  type UnitKind,
} from './schema';
import type { Vec3 } from './sketch/planes';
import { z } from './zod';

export const EMBOSS_TYPE = 'emboss';

/**
 * What can be embossed: sketch profiles (`<sketch>/<region>`) and whole texts
 * (`<sketch>/<text>`, P4-03, ADR-0058 §5: every ink region of the text, so it
 * survives editing the string).
 */
export const EMBOSS_PROFILE_KINDS: readonly GeomRefKind[] = ['profile', 'sketchEntity'];
/**
 * The faces to emboss on: any faces of one body (flat faces take the profiles
 * moved, cylinders and cones wrapped, anything else projected; P4-12).
 */
export const EMBOSS_FACE_KINDS: readonly GeomRefKind[] = ['face'];

/** `emboss` joins material outwards; `deboss` cuts it inwards. */
export const EMBOSS_MODES = ['emboss', 'deboss'] as const;
export type EmbossMode = (typeof EMBOSS_MODES)[number];

/** The depth an emboss has without a `depth` input, in mm (the dialog's default). */
export const EMBOSS_DEFAULT_DEPTH = 1;

export const EmbossInputsSchema = z.strictObject({
  /** The profiles and whole texts to emboss, all in one plane. Missing or empty: the feature fails until some are picked. */
  profiles: refsOf(EMBOSS_PROFILE_KINDS)
    .optional()
    .describe('The profiles and whole texts to emboss, all in one plane and parallel to the face.'),
  /** The faces to emboss on, all of one body: the body that owns them is the only body touched. */
  face: refsOf(EMBOSS_FACE_KINDS)
    .optional()
    .describe(
      'The faces to emboss on, all of one body: each takes the part of the letters that lands on it. The body is the only one touched.',
    ),
  /** How far the letters stand out or go in; must be greater than 0. */
  depth: exprOf('length')
    .optional()
    .describe('How far the letters stand out or go in; a length greater than 0.'),
  /** Default `emboss`. */
  mode: enumInput(EMBOSS_MODES)
    .optional()
    .describe('Emboss joins material outwards, deboss cuts inwards. Default emboss.'),
  /** Default false. */
  tangent: BoolInputSchema.optional().describe(
    'Lay the profiles on the face first, as if sketched on its tangent plane straight in front of them: any sketch angle, the letters read the right way round from outside. Default false.',
  ),
});
export type EmbossInputs = z.infer<typeof EmbossInputsSchema>;

/**
 * ADR-0068 §4, from the kernel's prism, wrap or projection (P4-04, ADR-0060):
 * a cap on the face it stands on and one out, a wall per edge of the
 * profiles, and with several faces a wall where the letters stop at a picked
 * face's edge (ADR-0060's second amendment B3).
 */
export const EMBOSS_FACE_ROLES: readonly FaceRole[] = [
  ...SWEEP_FACE_ROLES,
  {
    pattern: 'clip:<n>',
    description:
      "A wall where the letters stop at the edge of the picked faces: n is the face's place in the Faces list.",
  },
];

export const embossFeature: FeatureDefinition<EmbossInputs> = {
  type: EMBOSS_TYPE,
  label: 'Emboss',
  category: 'create',
  icon: 'emboss',
  inputsSchema: EmbossInputsSchema,
  faceRoles: EMBOSS_FACE_ROLES,
};

/** An emboss's inputs with every default filled in: what the kernel builds. */
export interface EmbossSettings {
  profiles: GeomRef[];
  /** The faces to emboss on, in list order (empty when none is picked). */
  faces: GeomRef[];
  /** The `expr` input holding the depth, if there is one (else `EMBOSS_DEFAULT_DEPTH`). */
  depth?: 'depth';
  mode: EmbossMode;
  /** Whether the profiles are laid on the face first (ADR-0060's second amendment B2). */
  tangent: boolean;
}

/** Reads an emboss's (valid) inputs with their defaults. */
export function embossSettings(inputs: EmbossInputs): EmbossSettings {
  return {
    profiles: inputs.profiles?.refs ?? [],
    faces: inputs.face?.refs ?? [],
    ...(inputs.depth ? { depth: 'depth' as const } : {}),
    mode: inputs.mode?.value ?? 'emboss',
    tangent: inputs.tangent?.value ?? false,
  };
}

export interface EmbossInputOptions {
  depth?: string;
  mode?: EmbossMode;
  tangent?: boolean;
}

/**
 * An emboss's inputs from plain options (tests, scripts; the dialog builds
 * the same shape). Expressions get their unit; `paramName`s are left to the
 * caller, as for any feature.
 */
export function embossInputs(
  profiles: GeomRef[],
  face: GeomRef | GeomRef[],
  options: EmbossInputOptions = {},
): EmbossInputs {
  const expr = (value: string, unit: UnitKind): ExprInput => ({ kind: 'expr', expr: value, unit });
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: EmbossInputs = {
    profiles: refs(profiles),
    face: refs(Array.isArray(face) ? face : [face]),
  };
  if (options.depth !== undefined) inputs.depth = expr(options.depth, 'length');
  if (options.mode) inputs.mode = { kind: 'enum', value: options.mode };
  if (options.tangent !== undefined) inputs.tangent = { kind: 'bool', value: options.tangent };
  return inputs;
}

/**
 * How an emboss put its profiles onto the face (P4-12, ADR-0060's amendment):
 * moved onto a flat face, wrapped round a cylinder or a cone, or projected
 * along the sketch's normal onto any other face. The kernel decides from the
 * face; it is no input.
 */
export const EMBOSS_METHODS = ['moved', 'wrapped-cylinder', 'wrapped-cone', 'projected'] as const;
export type EmbossMethod = (typeof EMBOSS_METHODS)[number];

/** What an emboss reports (`FeatureOutput.report`): the method it took. */
export interface EmbossReport {
  kind: 'emboss';
  /** The first face's method (`faces[0]`). */
  method: EmbossMethod;
  /**
   * Each picked face's method, in list order: the one it took after the
   * mixing rule (ADR-0060's second amendment B3). One entry for one face.
   */
  faces: EmbossMethod[];
  /**
   * With `tangent`: where the profiles were laid and the face's outward normal
   * there, for the dialog's arrow.
   */
  anchor?: { origin: Vec3; normal: Vec3 };
}

export function isEmbossReport(report: unknown): report is EmbossReport {
  return (report as { kind?: unknown } | null | undefined)?.kind === 'emboss';
}

/** The dialog's line for a method: "Wrapped round the cone". */
export function embossMethodText(method: EmbossMethod): string {
  switch (method) {
    case 'moved':
      return 'Moved onto the face';
    case 'wrapped-cylinder':
      return 'Wrapped round the cylinder';
    case 'wrapped-cone':
      return 'Wrapped round the cone';
    case 'projected':
      return 'Projected onto the face';
  }
}

/**
 * The dialog's line for several faces' methods: each method once, in order
 * of first appearance, with how many faces took it ("Moved onto 2 faces,
 * wrapped round the cylinder"). One face reads as `embossMethodText`.
 */
export function embossMethodsText(methods: readonly EmbossMethod[]): string {
  const counts = new Map<EmbossMethod, number>();
  for (const method of methods) counts.set(method, (counts.get(method) ?? 0) + 1);
  const text = [...counts]
    .map(([method, n]) => (n === 1 ? embossMethodText(method) : manyText(method, n)).toLowerCase())
    .join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Moved onto 2 faces": a method several faces took. */
function manyText(method: EmbossMethod, n: number): string {
  switch (method) {
    case 'moved':
      return `Moved onto ${n} faces`;
    case 'wrapped-cylinder':
      return `Wrapped round ${n} cylindrical faces`;
    case 'wrapped-cone':
      return `Wrapped round ${n} conical faces`;
    case 'projected':
      return `Projected onto ${n} faces`;
  }
}
