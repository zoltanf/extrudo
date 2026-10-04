/**
 * The Move/Copy feature (P3-06, ADR-0044, FR-FT-10): moves or turns bodies,
 * or copies them moved. Three modes:
 *
 * - `free` (the default): the bodies turn by `rx`, `ry`, `rz` about the
 *   world X, Y and Z axes through the centre of their bounding box, in that
 *   order, then move by `dx`, `dy`, `dz`. This is what the in-view gizmo
 *   (an arrow per axis, a ring per axis) drives.
 * - `rotate`: the bodies turn by `angle` about an `axis` (an origin axis,
 *   a construction axis, a straight edge or a sketch line), right-handed.
 * - `point-to-point`: the bodies move by the vector from the `from` point
 *   (a vertex or construction point) to the `to` point.
 *
 * Every input is optional and defaults to "no move" (0 mm, 0°). With `copy`
 * the bodies stay and the moved copies are new bodies (`<feature>:<n>`);
 * otherwise the bodies keep their IDs. The kernel adds its evaluator and
 * the web app its dialog, each in its own registry keyed by `MOVE_TYPE`
 * (ADR-0003).
 */
import { enumInput, exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import { REVOLVE_AXIS_KINDS } from './revolve';
import { BoolInputSchema, type ExprInput, type GeomRef, type RefInput } from './schema';
import { z } from './zod';

export const MOVE_TYPE = 'move';

export const MOVE_MODES = ['free', 'rotate', 'point-to-point'] as const;
export type MoveMode = (typeof MOVE_MODES)[number];

/** What a point-to-point move goes between: body vertices and construction points. */
export const MOVE_POINT_KINDS = ['vertex', 'point'] as const;

/** The distances and angles of `free`, by input name, with the world axis each belongs to. */
export const MOVE_DISTANCES = ['dx', 'dy', 'dz'] as const;
export const MOVE_TURNS = ['rx', 'ry', 'rz'] as const;

export const MoveInputsSchema = z.strictObject({
  /** The bodies to move (`body` references). Empty: the feature fails until some are picked. */
  bodies: refsOf(['body']),
  /** Default `free`. */
  mode: enumInput(MOVE_MODES).optional(),
  dx: exprOf('length').optional(),
  dy: exprOf('length').optional(),
  dz: exprOf('length').optional(),
  rx: exprOf('angle').optional(),
  ry: exprOf('angle').optional(),
  rz: exprOf('angle').optional(),
  /** `rotate`: the axis to turn about. */
  axis: refsOf(REVOLVE_AXIS_KINDS, 1).optional(),
  /** `rotate`: the angle, right-handed about the axis. */
  angle: exprOf('angle').optional(),
  /** `point-to-point`: where the move starts and ends. */
  from: refsOf(MOVE_POINT_KINDS, 1).optional(),
  to: refsOf(MOVE_POINT_KINDS, 1).optional(),
  /** Keep the bodies and add moved copies. Default false. */
  copy: BoolInputSchema.optional(),
});
export type MoveInputs = z.infer<typeof MoveInputsSchema>;

export const moveBodiesFeature: FeatureDefinition<MoveInputs> = {
  type: MOVE_TYPE,
  label: 'Move',
  category: 'modify',
  icon: 'move',
  inputsSchema: MoveInputsSchema,
};

/** A move's inputs with every default filled in: what the kernel builds. */
export interface MoveSettings {
  /** Body references, each once. */
  bodies: GeomRef[];
  mode: MoveMode;
  axis: GeomRef | undefined;
  from: GeomRef | undefined;
  to: GeomRef | undefined;
  copy: boolean;
}

/** Reads a move's (valid) inputs with their defaults. */
export function moveSettings(inputs: MoveInputs): MoveSettings {
  const seen = new Set<string>();
  return {
    bodies: inputs.bodies.refs.filter((ref) => !seen.has(ref.id) && seen.add(ref.id)),
    mode: inputs.mode?.value ?? 'free',
    axis: inputs.axis?.refs[0],
    from: inputs.from?.refs[0],
    to: inputs.to?.refs[0],
    copy: inputs.copy?.value ?? false,
  };
}

export interface MoveInputOptions {
  mode?: MoveMode;
  /** Length expressions: `'10 mm'`, `'wall * 2'`. */
  dx?: string;
  dy?: string;
  dz?: string;
  /** Angle expressions: `'90 deg'`. */
  rx?: string;
  ry?: string;
  rz?: string;
  axis?: GeomRef;
  angle?: string;
  from?: GeomRef;
  to?: GeomRef;
  copy?: boolean;
}

/** A move's inputs from body IDs and plain options (tests, scripts; the dialog builds the same shape). */
export function moveInputs(bodies: readonly string[], options: MoveInputOptions = {}): MoveInputs {
  const inputs: MoveInputs = {
    bodies: { kind: 'ref', refs: bodies.map((id): GeomRef => ({ kind: 'body', id })) },
  };
  const expr = (value: string, unit: 'length' | 'angle'): ExprInput => ({
    kind: 'expr',
    expr: value,
    unit,
  });
  const ref = (value: GeomRef): RefInput => ({ kind: 'ref', refs: [value] });
  const o = options;
  if (o.mode) inputs.mode = { kind: 'enum', value: o.mode };
  for (const name of MOVE_DISTANCES) {
    const value = o[name];
    if (value !== undefined) inputs[name] = expr(value, 'length');
  }
  for (const name of MOVE_TURNS) {
    const value = o[name];
    if (value !== undefined) inputs[name] = expr(value, 'angle');
  }
  if (o.axis) inputs.axis = ref(o.axis);
  if (o.angle !== undefined) inputs.angle = expr(o.angle, 'angle');
  if (o.from) inputs.from = ref(o.from);
  if (o.to) inputs.to = ref(o.to);
  if (o.copy !== undefined) inputs.copy = { kind: 'bool', value: o.copy };
  return inputs;
}
