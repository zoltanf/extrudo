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
import { z } from 'zod';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  ExprInputSchema,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
  RefInputSchema,
  type UnitKind,
} from './schema';

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
 * - `to-object`: up to a flat face, a vertex or a plane (`toObject`).
 * - `through-all`: just past every body in the way (the participants', or
 *   all bodies').
 */
export const EXTRUDE_EXTENTS = ['distance', 'to-object', 'through-all'] as const;
export type ExtrudeExtent = (typeof EXTRUDE_EXTENTS)[number];

/**
 * - `new-body`: a body per separate solid.
 * - `join`: fused into the bodies it touches (or `bodies`), which become one.
 * - `cut`: subtracted from the bodies it overlaps (or `bodies`).
 * - `intersect`: the bodies it overlaps (or `bodies`) keep only the overlap.
 */
export const EXTRUDE_OPERATIONS = ['new-body', 'join', 'cut', 'intersect'] as const;
export type ExtrudeOperation = (typeof EXTRUDE_OPERATIONS)[number];

/** What can be extruded: sketch profiles (`<sketch>/<region>`) and flat faces of bodies. */
export const EXTRUDE_PROFILE_KINDS: readonly GeomRefKind[] = ['profile', 'face'];
/** What an extrude can go up to: a flat face, a vertex, an origin or construction plane. */
export const EXTRUDE_OBJECT_KINDS: readonly GeomRefKind[] = ['face', 'vertex', 'plane'];

const enumInput = <T extends readonly [string, ...string[]]>(values: T) =>
  z.strictObject({ kind: z.literal('enum'), value: z.enum(values) });

const exprOf = (unit: UnitKind) =>
  ExprInputSchema.refine((input) => (input.unit ?? 'length') === unit, `must be ${an(unit)}`);

const refsOf = (kinds: readonly GeomRefKind[], max = Number.POSITIVE_INFINITY) =>
  RefInputSchema.refine(
    (input) => input.refs.length <= max && input.refs.every((ref) => kinds.includes(ref.kind)),
    max === 1 ? `must be one ${kinds.join(', ')}` : `must be ${kinds.join(' or ')} references`,
  );

function an(unit: UnitKind): string {
  return unit === 'unitless' ? 'a plain number' : `an ${unit === 'angle' ? 'angle' : 'length'}`;
}

export const ExtrudeInputsSchema = z.strictObject({
  /** Profiles and flat faces, all in one plane. Missing or empty: the feature fails until some are picked. */
  profiles: refsOf(EXTRUDE_PROFILE_KINDS).optional(),
  /** Default `one-side`. */
  direction: enumInput(EXTRUDE_DIRECTIONS).optional(),
  /** Side 1 (and symmetric): default `distance`. */
  extent: enumInput(EXTRUDE_EXTENTS).optional(),
  /** Side 1's length; the whole length when symmetric. */
  distance: exprOf('length').optional(),
  /** Side 1's object for `to-object`. */
  toObject: refsOf(EXTRUDE_OBJECT_KINDS, 1).optional(),
  /** Side 1's taper in degrees, default 0: positive widens along the sweep, negative narrows. */
  taper: exprOf('angle').optional(),
  /** Side 2 of `two-sides`, like side 1. */
  extent2: enumInput(EXTRUDE_EXTENTS).optional(),
  distance2: exprOf('length').optional(),
  toObject2: refsOf(EXTRUDE_OBJECT_KINDS, 1).optional(),
  taper2: exprOf('angle').optional(),
  /** Reverses the direction (side 1 against the normal). Default false. */
  flip: BoolInputSchema.optional(),
  /** Default `new-body`. */
  operation: enumInput(EXTRUDE_OPERATIONS).optional(),
  /**
   * The bodies to join, cut or intersect (`body` references, body IDs).
   * Empty or missing: every body the extrude touches (join) or overlaps
   * (cut, intersect).
   */
  bodies: refsOf(['body']).optional(),
});
export type ExtrudeInputs = z.infer<typeof ExtrudeInputsSchema>;

export const extrudeFeature: FeatureDefinition<ExtrudeInputs> = {
  type: EXTRUDE_TYPE,
  label: 'Extrude',
  category: 'create',
  icon: 'extrude',
  inputsSchema: ExtrudeInputsSchema,
};

/** The input names of each side, in `ExtrudeInputs`. */
export const EXTRUDE_SIDE_INPUTS = [
  { extent: 'extent', distance: 'distance', toObject: 'toObject', taper: 'taper' },
  { extent: 'extent2', distance: 'distance2', toObject: 'toObject2', taper: 'taper2' },
] as const;

export interface ExtrudeSide {
  extent: ExtrudeExtent;
  /** The `expr` input holding its distance, if there is one. */
  distance?: 'distance' | 'distance2';
  toObject?: GeomRef;
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
  /** An angle expression: `'5 deg'`. */
  taper?: string;
  extent2?: ExtrudeExtent;
  distance2?: string;
  toObject2?: GeomRef;
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
  if (o.taper !== undefined) inputs.taper = expr(o.taper, 'angle');
  if (o.extent2) inputs.extent2 = { kind: 'enum', value: o.extent2 };
  if (o.distance2 !== undefined) inputs.distance2 = expr(o.distance2, 'length');
  if (o.toObject2) inputs.toObject2 = refs([o.toObject2]);
  if (o.taper2 !== undefined) inputs.taper2 = expr(o.taper2, 'angle');
  if (o.flip !== undefined) inputs.flip = { kind: 'bool', value: o.flip };
  if (o.operation) inputs.operation = { kind: 'enum', value: o.operation };
  if (o.bodies) inputs.bodies = refs(o.bodies.map((id) => ({ kind: 'body', id })));
  return inputs;
}
