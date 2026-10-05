/**
 * Input schema pieces that solid features share (extrude, revolve, and the
 * features after them): enums, expressions of one unit, references of some
 * kinds, and the four body operations.
 *
 * Each piece says what it is under `meta({ input: … })`, which is what the
 * generated API methods read to type their plain values (`'10 mm'`, a face
 * reference, `true`) and turn them into the stored input (`design.ts`'s
 * `plainInput`, ADR-0068 §3).
 */
import { ExprInputSchema, type GeomRefKind, RefInputSchema, type UnitKind } from './schema';
import { z } from './zod';

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

/** What a `ref` input takes, read off a `refsOf` schema. */
export interface RefInputMeta {
  kind: 'ref';
  /** The reference kinds it accepts. */
  kinds: readonly GeomRefKind[];
  /** How many it takes at most; absent means any number. */
  max?: number;
}

/** What an `expr` input measures, read off an `exprOf` schema. */
export interface ExprInputMeta {
  kind: 'expr';
  unit: UnitKind;
  /**
   * The input takes an expression of any unit and stores which (an OpenSCAD
   * override, ADR-0071 §5): `unit` is what a plain value is given, and a
   * parameter keeps its own.
   */
  anyUnit?: boolean;
}

/** An `enum` input: its value is one of `values`, given as the string itself. */
export interface EnumInputMeta {
  kind: 'enum';
}

/** An `expr` input of one unit (a missing unit means length). */
export const exprOf = (unit: UnitKind) =>
  ExprInputSchema.refine((input) => (input.unit ?? 'length') === unit, `must be ${an(unit)}`).meta({
    input: { kind: 'expr', unit } satisfies ExprInputMeta,
  });

/** A `ref` input of these kinds, at most `max` of them. */
export const refsOf = (kinds: readonly GeomRefKind[], max = Number.POSITIVE_INFINITY) =>
  RefInputSchema.refine(
    (input) => input.refs.length <= max && input.refs.every((ref) => kinds.includes(ref.kind)),
    max === 1 ? `must be one ${kinds.join(', ')}` : `must be ${kinds.join(' or ')} references`,
  ).meta({ input: { kind: 'ref', kinds, max: Number.isFinite(max) ? max : undefined } });

/** An `enum` input whose value is one of `values`. */
export const enumInput = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .strictObject({ kind: z.literal('enum'), value: z.enum(values) })
    .meta({ input: { kind: 'enum' } satisfies EnumInputMeta });

function an(unit: UnitKind): string {
  if (unit === 'unitless') return 'a plain number';
  return unit === 'angle' ? 'an angle' : 'a length';
}
