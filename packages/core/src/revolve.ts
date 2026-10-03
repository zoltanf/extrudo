/**
 * The revolve feature (P2-07, ADR-0029, FR-FT-02): turns sketch profiles or
 * flat faces of bodies about an axis in their plane. The kernel adds its
 * evaluator and the web app its dialog, each in its own registry keyed by
 * `REVOLVE_TYPE` (ADR-0003).
 *
 * Every input except `profiles` and `axis` is optional and has a default,
 * so a minimal revolve is `{ profiles, axis }`: a full turn, new body.
 * Inputs a direction doesn't use are ignored (`angle2` unless it is
 * `two-sides`), as for extrude (ADR-0028), so a dialog can keep them while
 * the user switches back and forth.
 */
import { z } from 'zod';
import { BODY_OPERATIONS, type BodyOperation, enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import {
  BoolInputSchema,
  type ExprInput,
  type GeomRef,
  type GeomRefKind,
  type RefInput,
} from './schema';

export const REVOLVE_TYPE = 'revolve';

/**
 * - `one-side`: from the profile by `angle` about the axis (right-handed:
 *   counter-clockwise seen from the axis's tip), the other way with `flip`
 *   or a negative angle.
 * - `symmetric`: centred on the profile; `angle` is the whole angle.
 * - `two-sides`: side 1 by `angle` the positive way, side 2 by `angle2`
 *   the other way.
 */
export const REVOLVE_DIRECTIONS = ['one-side', 'symmetric', 'two-sides'] as const;
export type RevolveDirection = (typeof REVOLVE_DIRECTIONS)[number];

/** The body operations (`BODY_OPERATIONS`): new body, join, cut, intersect. */
export const REVOLVE_OPERATIONS = BODY_OPERATIONS;
export type RevolveOperation = BodyOperation;

/**
 * What can be revolved: sketch profiles (`<sketch>/<region>`), flat faces
 * of bodies, and whole texts (`<sketch>/<text>`, P4-03, ADR-0058 §5).
 */
export const REVOLVE_PROFILE_KINDS: readonly GeomRefKind[] = ['profile', 'face', 'sketchEntity'];
/**
 * What a revolve can turn about: an origin axis (`origin:x`…, later
 * construction axes), a sketch line (`sketchEntity`, `<sketch>/<entity>`,
 * construction lines too) or a straight edge of a body.
 */
export const REVOLVE_AXIS_KINDS: readonly GeomRefKind[] = ['axis', 'sketchEntity', 'edge'];

/** The angle of a revolve without one: a full turn. */
export const FULL_TURN = '360 deg';

export const RevolveInputsSchema = z.strictObject({
  /** Profiles and flat faces, all in one plane. Missing or empty: the feature fails until some are picked. */
  profiles: refsOf(REVOLVE_PROFILE_KINDS).optional(),
  /** The axis, in the profiles' plane. Missing: the feature fails until one is picked. */
  axis: refsOf(REVOLVE_AXIS_KINDS, 1).optional(),
  /** Default `one-side`. */
  direction: enumInput(REVOLVE_DIRECTIONS).optional(),
  /**
   * Side 1's angle (the whole angle when symmetric), default 360°: a full
   * turn has no end faces. Negative turns the other way.
   */
  angle: exprOf('angle').optional(),
  /** Side 2's angle for `two-sides`: the other way round. Default 0. */
  angle2: exprOf('angle').optional(),
  /** Turns side 1 the other way round the axis. Default false. */
  flip: BoolInputSchema.optional(),
  /** Default `new-body`. */
  operation: enumInput(REVOLVE_OPERATIONS).optional(),
  /**
   * The bodies to join, cut or intersect (`body` references, body IDs).
   * Empty or missing: every body the revolve touches (join) or overlaps
   * (cut, intersect).
   */
  bodies: refsOf(['body']).optional(),
});
export type RevolveInputs = z.infer<typeof RevolveInputsSchema>;

export const revolveFeature: FeatureDefinition<RevolveInputs> = {
  type: REVOLVE_TYPE,
  label: 'Revolve',
  category: 'create',
  icon: 'revolve',
  inputsSchema: RevolveInputsSchema,
};

/** A revolve's inputs with every default filled in: what the kernel builds. */
export interface RevolveSettings {
  profiles: GeomRef[];
  axis: GeomRef | undefined;
  direction: RevolveDirection;
  /** The `expr` input holding side 1's angle; none means the default full turn. */
  angle?: 'angle';
  /** Two sides only: the `expr` input holding side 2's angle; none means 0. */
  angle2?: 'angle2';
  flip: boolean;
  operation: RevolveOperation;
  /** Explicit participants (body IDs); empty means automatic. */
  bodies: string[];
}

/** Reads a revolve's (valid) inputs with their defaults. */
export function revolveSettings(inputs: RevolveInputs): RevolveSettings {
  const direction = inputs.direction?.value ?? 'one-side';
  return {
    profiles: inputs.profiles?.refs ?? [],
    axis: inputs.axis?.refs[0],
    direction,
    ...(inputs.angle ? { angle: 'angle' as const } : {}),
    ...(direction === 'two-sides' && inputs.angle2 ? { angle2: 'angle2' as const } : {}),
    flip: inputs.flip?.value ?? false,
    operation: inputs.operation?.value ?? 'new-body',
    bodies: (inputs.bodies?.refs ?? []).map((ref) => ref.id),
  };
}

export interface RevolveInputOptions {
  direction?: RevolveDirection;
  /** An angle expression: `'90 deg'`, `'sweep / 2'`. */
  angle?: string;
  angle2?: string;
  flip?: boolean;
  operation?: RevolveOperation;
  bodies?: string[];
}

/**
 * A revolve's inputs from plain options (tests, scripts; the dialog builds
 * the same shape). Expressions get their unit; `paramName`s are left to the
 * caller, as for any feature.
 */
export function revolveInputs(
  profiles: GeomRef[],
  axis: GeomRef | undefined,
  options: RevolveInputOptions = {},
): RevolveInputs {
  const expr = (value: string): ExprInput => ({ kind: 'expr', expr: value, unit: 'angle' });
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: RevolveInputs = { profiles: refs(profiles) };
  const o = options;
  if (axis) inputs.axis = refs([axis]);
  if (o.direction) inputs.direction = { kind: 'enum', value: o.direction };
  if (o.angle !== undefined) inputs.angle = expr(o.angle);
  if (o.angle2 !== undefined) inputs.angle2 = expr(o.angle2);
  if (o.flip !== undefined) inputs.flip = { kind: 'bool', value: o.flip };
  if (o.operation) inputs.operation = { kind: 'enum', value: o.operation };
  if (o.bodies) inputs.bodies = refs(o.bodies.map((id) => ({ kind: 'body', id })));
  return inputs;
}
