/**
 * The extrude feature (P2-06, ADR-0028, FR-FT-01): sweeps sketch profiles or
 * flat faces of bodies straight along their plane's normal. The kernel adds
 * its evaluator and the web app its dialog, each in its own registry keyed
 * by `EXTRUDE_TYPE` (ADR-0003).
 *
 * Every input except `profiles` is optional and has a default, so a minimal
 * extrude is `{ profiles, distance }`: one side, new body, no taper. Inputs
 * a direction doesn't use are ignored (side 2 unless it is `two-sides`), so
 * a dialog can keep them while the user switches back and forth.
 */

import { SWEEP_FACE_ROLES } from './face-roles';
import { BODY_OPERATIONS, type BodyOperation, enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
  type UnitKind,
} from './schema';
import { z } from './zod';

export const EXTRUDE_TYPE = 'extrude';

/**
 * - `one-side`: from the profile's plane along its normal (or against it,
 *   with `flip` or a negative distance).
 * - `symmetric`: centred on the plane; `distance` is the whole length.
 * - `two-sides`: side 1 along the normal, side 2 against it, each with its
 *   own extent and taper.
 */
export const EXTRUDE_DIRECTIONS = ['one-side', 'symmetric', 'two-sides'] as const;
export type ExtrudeDirection = (typeof EXTRUDE_DIRECTIONS)[number];

/**
 * - `distance`: a length (negative goes the other way).
 * - `to-object`: up to a face (flat or curved), a body, a vertex or a plane
 *   (`toObject`), moved along the sweep by `offset` (P4-12).
 * - `through-all`: just past every body in the way (the participants', or
 *   all bodies').
 */
export const EXTRUDE_EXTENTS = ['distance', 'to-object', 'through-all'] as const;
export type ExtrudeExtent = (typeof EXTRUDE_EXTENTS)[number];

/** The body operations (`BODY_OPERATIONS`): new body, join, cut, intersect. */
export const EXTRUDE_OPERATIONS = BODY_OPERATIONS;
export type ExtrudeOperation = BodyOperation;

/**
 * What can be extruded: sketch profiles (`<sketch>/<region>`), flat faces
 * of bodies, and whole texts (`<sketch>/<text>`, P4-03, ADR-0058 §5: every
 * ink region of the text, so it survives editing the string).
 */
export const EXTRUDE_PROFILE_KINDS: readonly GeomRefKind[] = ['profile', 'face', 'sketchEntity'];
/**
 * What an extrude can go up to: a face (flat or, since P4-12, curved), a body
 * (P4-12: the sweep stops where it first meets it), a vertex, an origin or
 * construction plane.
 */
export const EXTRUDE_OBJECT_KINDS: readonly GeomRefKind[] = ['face', 'body', 'vertex', 'plane'];

export const ExtrudeInputsSchema = z.strictObject({
  /** Profiles and flat faces, all in one plane. Missing or empty: the feature fails until some are picked. */
  profiles: refsOf(EXTRUDE_PROFILE_KINDS)
    .optional()
    .describe('Profiles and flat faces to sweep, all in one plane.'),
  /** Default `one-side`. */
  direction: enumInput(EXTRUDE_DIRECTIONS)
    .optional()
    .describe(
      'How the sweep leaves the plane: one-side, symmetric or two-sides. Default one-side.',
    ),
  /** Side 1 (and symmetric): default `distance`. */
  extent: enumInput(EXTRUDE_EXTENTS)
    .optional()
    .describe("Side 1's extent: distance, to-object or through-all. Default distance."),
  /** Side 1's length; the whole length when symmetric. */
  distance: exprOf('length')
    .optional()
    .describe("Side 1's length (the whole length when symmetric); a length."),
  /** Side 1's object for `to-object`. */
  toObject: refsOf(EXTRUDE_OBJECT_KINDS, 1)
    .optional()
    .describe(
      'The face (flat or curved), body, vertex or plane side 1 stops at, where the sweep first meets it.',
    ),
  /**
   * Side 1's offset from its object for `to-object` (P4-12), default 0: the
   * object is moved along the sweep by it, so positive goes past it.
   */
  offset: exprOf('length')
    .optional()
    .describe(
      "How far past side 1's object the extrude ends, along the sweep; a length. Negative stops short. Default 0; read only for to-object.",
    ),
  /** Side 1's taper in degrees, default 0: positive widens along the sweep, negative narrows. */
  taper: exprOf('angle')
    .optional()
    .describe(
      "Side 1's taper; an angle. Positive widens the sweep, the default 0° keeps the section's size.",
    ),
  /** Side 2 of `two-sides`, like side 1. */
  extent2: enumInput(EXTRUDE_EXTENTS)
    .optional()
    .describe("Side 2's extent, like side 1. Default distance."),
  distance2: exprOf('length').optional().describe("Side 2's length; a length."),
  toObject2: refsOf(EXTRUDE_OBJECT_KINDS, 1)
    .optional()
    .describe('The face, body, vertex or plane side 2 stops at.'),
  offset2: exprOf('length')
    .optional()
    .describe("How far past side 2's object it ends; a length. Default 0."),
  taper2: exprOf('angle').optional().describe("Side 2's taper; an angle."),
  /** Reverses the direction (side 1 against the normal). Default false. */
  flip: BoolInputSchema.optional().describe(
    "Sweep side 1 against the plane's normal. Default false.",
  ),
  /** Default `new-body`. */
  operation: enumInput(EXTRUDE_OPERATIONS)
    .optional()
    .describe('New body, join, cut or intersect. Default new-body.'),
  /**
   * The bodies to join, cut or intersect (`body` references, body IDs).
   * Empty or missing: every body the extrude touches (join) or overlaps
   * (cut, intersect).
   */
  bodies: refsOf(['body'])
    .optional()
    .describe(
      'The bodies to join, cut or intersect; by default every body the extrude touches (join) or overlaps (cut, intersect).',
    ),
});
export type ExtrudeInputs = z.infer<typeof ExtrudeInputsSchema>;

export const extrudeFeature: FeatureDefinition<ExtrudeInputs> = {
  type: EXTRUDE_TYPE,
  label: 'Extrude',
  category: 'create',
  icon: 'extrude',
  inputsSchema: ExtrudeInputsSchema,
  // ADR-0068 §4, from the kernel's `sweep` (P2-06).
  faceRoles: [
    ...SWEEP_FACE_ROLES,
    {
      pattern: 'cap:plane',
      description:
        'The middle face of a two-sided tapered extrude: the plane the two sides meet in.',
    },
    {
      pattern: 'side2:<curve>',
      description: 'A wall of side 2, when both sides of a two-sided extrude are tapered.',
    },
    {
      pattern: 'trim:<curve>',
      description: 'The end where the sweep was trimmed to an object (To object).',
    },
  ],
};

/** The input names of each side, in `ExtrudeInputs`. */
export const EXTRUDE_SIDE_INPUTS = [
  {
    extent: 'extent',
    distance: 'distance',
    toObject: 'toObject',
    offset: 'offset',
    taper: 'taper',
  },
  {
    extent: 'extent2',
    distance: 'distance2',
    toObject: 'toObject2',
    offset: 'offset2',
    taper: 'taper2',
  },
] as const;

export interface ExtrudeSide {
  extent: ExtrudeExtent;
  /** The `expr` input holding its distance, if there is one. */
  distance?: 'distance' | 'distance2';
  toObject?: GeomRef;
  /** The `expr` input holding its offset from `toObject`, if there is one (none means 0). */
  offset?: 'offset' | 'offset2';
  /** The `expr` input holding its taper, if there is one (none means 0). */
  taper?: 'taper' | 'taper2';
}

/** An extrude's inputs with every default filled in: what the kernel builds. */
export interface ExtrudeSettings {
  profiles: GeomRef[];
  direction: ExtrudeDirection;
  /** One side for `one-side` and `symmetric`, two for `two-sides`. Symmetric uses side 1 both ways. */
  sides: ExtrudeSide[];
  flip: boolean;
  operation: ExtrudeOperation;
  /** Explicit participants (body IDs); empty means automatic. */
  bodies: string[];
}

/** Reads an extrude's (valid) inputs with their defaults. */
export function extrudeSettings(inputs: ExtrudeInputs): ExtrudeSettings {
  const direction = inputs.direction?.value ?? 'one-side';
  const side = (n: 0 | 1): ExtrudeSide => {
    const names = EXTRUDE_SIDE_INPUTS[n];
    const toObject = inputs[names.toObject]?.refs[0];
    return {
      extent: inputs[names.extent]?.value ?? 'distance',
      ...(inputs[names.distance] ? { distance: names.distance } : {}),
      ...(toObject ? { toObject } : {}),
      ...(inputs[names.offset] ? { offset: names.offset } : {}),
      ...(inputs[names.taper] ? { taper: names.taper } : {}),
    };
  };
  return {
    profiles: inputs.profiles?.refs ?? [],
    direction,
    sides: direction === 'two-sides' ? [side(0), side(1)] : [side(0)],
    flip: inputs.flip?.value ?? false,
    operation: inputs.operation?.value ?? 'new-body',
    bodies: (inputs.bodies?.refs ?? []).map((ref) => ref.id),
  };
}

export interface ExtrudeInputOptions {
  direction?: ExtrudeDirection;
  extent?: ExtrudeExtent;
  /** An expression: `'10 mm'`, `'wall * 5'`. */
  distance?: string;
  toObject?: GeomRef;
  /** A length expression: how far past `toObject` (`'2 mm'`). */
  offset?: string;
  /** An angle expression: `'5 deg'`. */
  taper?: string;
  extent2?: ExtrudeExtent;
  distance2?: string;
  toObject2?: GeomRef;
  offset2?: string;
  taper2?: string;
  flip?: boolean;
  operation?: ExtrudeOperation;
  bodies?: string[];
}

/**
 * An extrude's inputs from plain options (tests, scripts; the dialog builds
 * the same shape). Expressions get their unit; `paramName`s are left to the
 * caller, as for any feature.
 */
export function extrudeInputs(
  profiles: GeomRef[],
  options: ExtrudeInputOptions = {},
): ExtrudeInputs {
  const expr = (value: string, unit: UnitKind): ExprInput => ({ kind: 'expr', expr: value, unit });
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: ExtrudeInputs = { profiles: refs(profiles) };
  const o = options;
  if (o.direction) inputs.direction = { kind: 'enum', value: o.direction };
  if (o.extent) inputs.extent = { kind: 'enum', value: o.extent };
  if (o.distance !== undefined) inputs.distance = expr(o.distance, 'length');
  if (o.toObject) inputs.toObject = refs([o.toObject]);
  if (o.offset !== undefined) inputs.offset = expr(o.offset, 'length');
  if (o.taper !== undefined) inputs.taper = expr(o.taper, 'angle');
  if (o.extent2) inputs.extent2 = { kind: 'enum', value: o.extent2 };
  if (o.distance2 !== undefined) inputs.distance2 = expr(o.distance2, 'length');
  if (o.toObject2) inputs.toObject2 = refs([o.toObject2]);
  if (o.offset2 !== undefined) inputs.offset2 = expr(o.offset2, 'length');
  if (o.taper2 !== undefined) inputs.taper2 = expr(o.taper2, 'angle');
  if (o.flip !== undefined) inputs.flip = { kind: 'bool', value: o.flip };
  if (o.operation) inputs.operation = { kind: 'enum', value: o.operation };
  if (o.bodies) inputs.bodies = refs(o.bodies.map((id) => ({ kind: 'body', id })));
  return inputs;
}
