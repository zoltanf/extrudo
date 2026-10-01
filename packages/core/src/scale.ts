/**
 * The Scale feature (P3-08, FR-FT-12): makes bodies larger or smaller about
 * a point, by one factor (`uniform`, the default) or by a factor along each
 * world axis (`non-uniform`: `x`, `y`, `z`). The point is a body vertex or
 * a construction point; without one the bodies scale about the centre of
 * the box that holds them. With `copy` the bodies stay and scaled copies are
 * new bodies (`<feature>:<n>`); otherwise the bodies keep their IDs.
 *
 * Factors are plain numbers (`unitless` expressions): `2`, `0.5`,
 * `1 + shrink / 100`. Every input but `bodies` is optional, a missing
 * factor is 1. The kernel adds its evaluator and the web app its dialog,
 * each in its own registry keyed by `SCALE_TYPE` (ADR-0003).
 */
import { z } from 'zod';
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { MOVE_POINT_KINDS } from './move';
import { BoolInputSchema, type ExprInput, type GeomRef } from './schema';

export const SCALE_TYPE = 'scale';

export const SCALE_MODES = ['uniform', 'non-uniform'] as const;
export type ScaleMode = (typeof SCALE_MODES)[number];

/** What a scale can be centred on: a body vertex or a construction point. */
export const SCALE_POINT_KINDS = MOVE_POINT_KINDS;

/** The per-axis factors of `non-uniform`, by input name. */
export const SCALE_AXES = ['x', 'y', 'z'] as const;

export const ScaleInputsSchema = z.strictObject({
  /** The bodies to scale. Empty: the feature fails until some are picked. */
  bodies: refsOf(['body']),
  /** The fixed point. Absent: the centre of the bodies' box. */
  point: refsOf(SCALE_POINT_KINDS, 1).optional(),
  /** Default `uniform`. */
  mode: enumInput(SCALE_MODES).optional(),
  /** `uniform`: the factor (a plain number greater than 0). Default 1. */
  factor: exprOf('unitless').optional(),
  /** `non-uniform`: the factors along the world X, Y and Z axes. Default 1 each. */
  x: exprOf('unitless').optional(),
  y: exprOf('unitless').optional(),
  z: exprOf('unitless').optional(),
  /** Keep the bodies and add scaled copies. Default false. */
  copy: BoolInputSchema.optional(),
});
export type ScaleInputs = z.infer<typeof ScaleInputsSchema>;

export const scaleFeature: FeatureDefinition<ScaleInputs> = {
  type: SCALE_TYPE,
  label: 'Scale',
  category: 'modify',
  icon: 'scale',
  inputsSchema: ScaleInputsSchema,
};

/** A scale's inputs with every default filled in (but the factors, which are expressions). */
export interface ScaleSettings {
  /** Body references, each once. */
  bodies: GeomRef[];
  point: GeomRef | undefined;
  mode: ScaleMode;
  copy: boolean;
}

/** Reads a scale's (valid) inputs with their defaults. */
export function scaleSettings(inputs: ScaleInputs): ScaleSettings {
  const seen = new Set<string>();
  return {
    bodies: inputs.bodies.refs.filter((ref) => !seen.has(ref.id) && seen.add(ref.id)),
    point: inputs.point?.refs[0],
    mode: inputs.mode?.value ?? 'uniform',
    copy: inputs.copy?.value ?? false,
  };
}

export interface ScaleInputOptions {
  mode?: ScaleMode;
  /** Plain-number expressions: `'2'`, `'1 + shrink / 100'`. */
  factor?: string;
  x?: string;
  y?: string;
  z?: string;
  point?: GeomRef;
  copy?: boolean;
}

/** A scale's inputs from body IDs and plain options (tests, scripts; the dialog builds the same shape). */
export function scaleInputs(
  bodies: readonly string[],
  options: ScaleInputOptions = {},
): ScaleInputs {
  const inputs: ScaleInputs = {
    bodies: { kind: 'ref', refs: bodies.map((id): GeomRef => ({ kind: 'body', id })) },
  };
  const expr = (value: string): ExprInput => ({ kind: 'expr', expr: value, unit: 'unitless' });
  const o = options;
  if (o.mode) inputs.mode = { kind: 'enum', value: o.mode };
  if (o.factor !== undefined) inputs.factor = expr(o.factor);
  for (const name of SCALE_AXES) {
    const value = o[name];
    if (value !== undefined) inputs[name] = expr(value);
  }
  if (o.point) inputs.point = { kind: 'ref', refs: [o.point] };
  if (o.copy !== undefined) inputs.copy = { kind: 'bool', value: o.copy };
  return inputs;
}
