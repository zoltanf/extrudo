/**
 * The sweep feature (P4-01, ADR-0055, FR-FT-14): moves sketch profiles or
 * flat faces of bodies along a path of sketch curves or body edges (chained
 * end to end), and makes new bodies or joins, cuts or intersects like
 * extrude. The kernel adds its evaluator and the web app its dialog, each in
 * its own registry keyed by `SWEEP_TYPE` (ADR-0003).
 *
 * The profile stays where it is and travels with the path from the path's
 * end nearer to it: it need not touch the path, and the path may be picked
 * from either end. Every input but `profiles` and `path` is optional, so a
 * minimal sweep is `{ profiles, path }`: following the path, no twist, no
 * scale, a new body.
 */
import { z } from 'zod';
import { BODY_OPERATIONS, type BodyOperation, enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { ExprInput, GeomRef, GeomRefKind, RefInput } from './schema';

export const SWEEP_TYPE = 'sweep';

/**
 * How the profile turns as it travels:
 * - `follow`: it keeps its angle to the path (square to it stays square).
 * - `fixed`: it doesn't turn; it stays parallel to where it started.
 */
export const SWEEP_ORIENTATIONS = ['follow', 'fixed'] as const;
export type SweepOrientationInput = (typeof SWEEP_ORIENTATIONS)[number];

/** What can be swept: sketch profiles (`<sketch>/<region>`) and flat faces of bodies, in one plane. */
export const SWEEP_PROFILE_KINDS: readonly GeomRefKind[] = ['profile', 'face'];
/** What a path is made of: sketch curves (`<sketch>/<entity>`, construction ones too) and body edges. */
export const SWEEP_PATH_KINDS: readonly GeomRefKind[] = ['sketchEntity', 'edge'];

export const SweepInputsSchema = z.strictObject({
  /** Missing or empty: the feature fails until some are picked. */
  profiles: refsOf(SWEEP_PROFILE_KINDS).optional(),
  /** Sketch curves and edges that join end to end into one chain. */
  path: refsOf(SWEEP_PATH_KINDS).optional(),
  /** Default `follow`. */
  orientation: enumInput(SWEEP_ORIENTATIONS).optional(),
  /**
   * How far the profile turns about the path from start to end, evenly
   * along it; default 0. Only with `follow`, along a smooth path.
   */
  twist: exprOf('angle').optional(),
  /** The profile's size at the path's end, as a factor of its size at the start; default 1. */
  scale: exprOf('unitless').optional(),
  /** Default `new-body`. */
  operation: enumInput(BODY_OPERATIONS).optional(),
  /**
   * The bodies to join, cut or intersect (`body` references, body IDs).
   * Empty or missing: every body the sweep touches (join) or overlaps
   * (cut, intersect).
   */
  bodies: refsOf(['body']).optional(),
});
export type SweepInputs = z.infer<typeof SweepInputsSchema>;

export const sweepFeature: FeatureDefinition<SweepInputs> = {
  type: SWEEP_TYPE,
  label: 'Sweep',
  category: 'create',
  icon: 'sweep',
  inputsSchema: SweepInputsSchema,
};

/** A sweep's inputs with every default filled in: what the kernel builds. */
export interface SweepSettings {
  profiles: GeomRef[];
  path: GeomRef[];
  orientation: SweepOrientationInput;
  /** The `expr` input holding the twist; none means 0. */
  twist?: 'twist';
  /** The `expr` input holding the end scale; none means 1. */
  scale?: 'scale';
  operation: BodyOperation;
  /** Explicit participants (body IDs); empty means automatic. */
  bodies: string[];
}

/** Reads a sweep's (valid) inputs with their defaults. */
export function sweepSettings(inputs: SweepInputs): SweepSettings {
  return {
    profiles: inputs.profiles?.refs ?? [],
    path: inputs.path?.refs ?? [],
    orientation: inputs.orientation?.value ?? 'follow',
    ...(inputs.twist ? { twist: 'twist' as const } : {}),
    ...(inputs.scale ? { scale: 'scale' as const } : {}),
    operation: inputs.operation?.value ?? 'new-body',
    bodies: (inputs.bodies?.refs ?? []).map((ref) => ref.id),
  };
}

export interface SweepInputOptions {
  orientation?: SweepOrientationInput;
  /** An angle expression: `'90 deg'`. */
  twist?: string;
  /** A plain number expression: `'0.5'`. */
  scale?: string;
  operation?: BodyOperation;
  bodies?: string[];
}

/**
 * A sweep's inputs from plain options (tests, scripts; the dialog builds
 * the same shape). Expressions get their unit; `paramName`s are left to the
 * caller, as for any feature.
 */
export function sweepInputs(
  profiles: GeomRef[],
  path: GeomRef[],
  options: SweepInputOptions = {},
): SweepInputs {
  const refs = (list: GeomRef[]): RefInput => ({ kind: 'ref', refs: list });
  const inputs: SweepInputs = { profiles: refs(profiles), path: refs(path) };
  const o = options;
  if (o.orientation) inputs.orientation = { kind: 'enum', value: o.orientation };
  if (o.twist !== undefined) {
    inputs.twist = { kind: 'expr', expr: o.twist, unit: 'angle' } satisfies ExprInput;
  }
  if (o.scale !== undefined) {
    inputs.scale = { kind: 'expr', expr: o.scale, unit: 'unitless' } satisfies ExprInput;
  }
  if (o.operation) inputs.operation = { kind: 'enum', value: o.operation };
  if (o.bodies) inputs.bodies = refs(o.bodies.map((id) => ({ kind: 'body', id })));
  return inputs;
}
