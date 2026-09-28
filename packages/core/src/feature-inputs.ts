/**
 * Input schema pieces that solid features share (extrude, revolve, and the
 * features after them): enums, expressions of one unit, references of some
 * kinds, and the four body operations.
 */
import { z } from 'zod';
import { ExprInputSchema, type GeomRefKind, RefInputSchema, type UnitKind } from './schema';

/**
 * What a solid feature does with the solid it makes (FR-FT-01):
 *
 * - `new-body`: a body per separate solid.
 * - `join`: fused into the bodies it touches (or `bodies`), which become one.
 * - `cut`: subtracted from the bodies it overlaps (or `bodies`).
 * - `intersect`: the bodies it overlaps (or `bodies`) keep only the overlap.
 */
export const BODY_OPERATIONS = ['new-body', 'join', 'cut', 'intersect'] as const;
export type BodyOperation = (typeof BODY_OPERATIONS)[number];

/** An `enum` input whose value is one of `values`. */
export const enumInput = <T extends readonly [string, ...string[]]>(values: T) =>
  z.strictObject({ kind: z.literal('enum'), value: z.enum(values) });

/** An `expr` input of one unit (a missing unit means length). */
export const exprOf = (unit: UnitKind) =>
  ExprInputSchema.refine((input) => (input.unit ?? 'length') === unit, `must be ${an(unit)}`);

/** A `ref` input of these kinds, at most `max` of them. */
export const refsOf = (kinds: readonly GeomRefKind[], max = Number.POSITIVE_INFINITY) =>
  RefInputSchema.refine(
    (input) => input.refs.length <= max && input.refs.every((ref) => kinds.includes(ref.kind)),
    max === 1 ? `must be one ${kinds.join(', ')}` : `must be ${kinds.join(' or ')} references`,
  );

function an(unit: UnitKind): string {
  return unit === 'unitless' ? 'a plain number' : `an ${unit === 'angle' ? 'angle' : 'length'}`;
}
