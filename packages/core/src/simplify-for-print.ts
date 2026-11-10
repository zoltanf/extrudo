/**
 * The Simplify for Print feature (ADR-0141, #79): on the chosen bodies,
 * removes every round under a radius, every chamfer under a size and every
 * hole under a diameter at once, with Remove Faces' defeaturing (ADR-0099). Meant for parts imported
 * from engineering CAD, whose small rounds, chamfers and holes a print doesn't need.
 *
 * The feature stores the bodies and the limits, never faces: the kernel
 * finds them on every recompute, so a changed limit or an
 * upstream edit finds them again. Each round or hole is its own attempt, so
 * one that can't be removed doesn't stop the rest; the report says which
 * went and which stayed. Each kind can be off (`rounds` / `chamfers` / `holes`).
 *
 * The kernel adds its evaluator and the web app its dialog, each in its own
 * registry keyed by `SIMPLIFY_FOR_PRINT_TYPE` (ADR-0003).
 */
import { exprOf, refsOf } from './feature-inputs';
import type { FeatureDefinition } from './features';
import type { Feature, GeomRef } from './schema';
import { BoolInputSchema } from './schema';
import { z } from './zod';

export const SIMPLIFY_FOR_PRINT_TYPE = 'simplifyForPrint';

export const SimplifyForPrintInputsSchema = z.strictObject({
  /** The bodies to simplify. Empty: the feature fails until some are picked. */
  bodies: refsOf(['body']).describe('The solid bodies to simplify. Required.'),
  /** Remove rounds (default true while `maxRoundRadius` is set). */
  rounds: BoolInputSchema.optional().describe(
    'Remove rounds (fillets: cylinder, torus and sphere faces in a smooth chain) up to maxRoundRadius; false keeps them and the limit. Absent: on while maxRoundRadius is given.',
  ),
  /** The largest round radius removed. Absent: rounds stay. */
  maxRoundRadius: exprOf('length')
    .optional()
    .describe(
      'The largest round radius removed, in mm (a torus by its tube radius). Absent: no round is removed.',
    ),
  /** Remove chamfers (default true while `maxChamferSize` is set). */
  chamfers: BoolInputSchema.optional().describe(
    'Remove chamfers (narrow flat or conical bevels between two faces that meet at an angle) up to maxChamferSize; false keeps them and the limit. Absent: on while maxChamferSize is given.',
  ),
  /** The largest chamfer removed, by its longer leg. Absent: chamfers stay. */
  maxChamferSize: exprOf('length')
    .optional()
    .describe(
      'The largest chamfer removed, in mm, by its longer leg (how far it cuts back into either face). Absent: no chamfer is removed.',
    ),
  /** Remove holes (default true while `maxHoleDiameter` is set). */
  holes: BoolInputSchema.optional().describe(
    'Remove holes (closed cylindrical walls, the faces they enclose and the round at their mouth) up to maxHoleDiameter; false keeps them and the limit. Absent: on while maxHoleDiameter is given.',
  ),
  /** The largest hole diameter removed. Absent: holes stay. */
  maxHoleDiameter: exprOf('length')
    .optional()
    .describe(
      'The largest hole diameter removed, in mm (a counterbored hole by its widest wall). Absent: no hole is removed.',
    ),
});
export type SimplifyForPrintInputs = z.infer<typeof SimplifyForPrintInputsSchema>;

export const simplifyForPrintFeature: FeatureDefinition<SimplifyForPrintInputs> = {
  type: SIMPLIFY_FOR_PRINT_TYPE,
  label: 'Simplify for Print',
  category: 'modify',
  icon: 'simplify-for-print',
  inputsSchema: SimplifyForPrintInputsSchema,
};

/** The limits a simplification works with, in mm; undefined where that kind is off. */
export interface SimplifyLimits {
  maxRoundRadius: number | undefined;
  maxChamferSize: number | undefined;
  maxHoleDiameter: number | undefined;
}

/** Which kinds are on: a kind is on while its limit is given and its toggle isn't false. */
export function simplifyKinds(inputs: SimplifyForPrintInputs): {
  rounds: boolean;
  chamfers: boolean;
  holes: boolean;
} {
  return {
    rounds: inputs.maxRoundRadius !== undefined && inputs.rounds?.value !== false,
    chamfers: inputs.maxChamferSize !== undefined && inputs.chamfers?.value !== false,
    holes: inputs.maxHoleDiameter !== undefined && inputs.holes?.value !== false,
  };
}

export interface SimplifyInputOptions {
  /** A length expression: `'1 mm'`, `'r_max'`. Absent: rounds stay. */
  maxRoundRadius?: string;
  /** A length expression. Absent: chamfers stay. */
  maxChamferSize?: string;
  /** A length expression. Absent: holes stay. */
  maxHoleDiameter?: string;
}

/** A simplification's inputs from body IDs and limits (tests, scripts; the dialog builds the same shape). */
export function simplifyForPrintInputs(
  bodies: readonly string[],
  options: SimplifyInputOptions,
): SimplifyForPrintInputs {
  const inputs: SimplifyForPrintInputs = {
    bodies: { kind: 'ref', refs: bodies.map((id): GeomRef => ({ kind: 'body', id })) },
  };
  if (options.maxRoundRadius !== undefined) {
    inputs.rounds = { kind: 'bool', value: true };
    inputs.maxRoundRadius = { kind: 'expr', expr: options.maxRoundRadius, unit: 'length' };
  }
  if (options.maxChamferSize !== undefined) {
    inputs.chamfers = { kind: 'bool', value: true };
    inputs.maxChamferSize = { kind: 'expr', expr: options.maxChamferSize, unit: 'length' };
  }
  if (options.maxHoleDiameter !== undefined) {
    inputs.holes = { kind: 'bool', value: true };
    inputs.maxHoleDiameter = { kind: 'expr', expr: options.maxHoleDiameter, unit: 'length' };
  }
  return inputs;
}

/** A Simplify for Print feature. The caller makes the ID and the name. */
export function simplifyForPrintFeatureOf(
  id: Feature['id'],
  name: string,
  bodies: readonly string[],
  options: SimplifyInputOptions,
): Feature {
  return {
    id,
    type: SIMPLIFY_FOR_PRINT_TYPE,
    name,
    suppressed: false,
    inputs: simplifyForPrintInputs(bodies, options),
  };
}

/** One round, chamfer or hole the kernel found (ADR-0141 §3): one removal attempt. */
export interface SimplifyGroup {
  kind: 'round' | 'chamfer' | 'hole';
  /** The body it is on. */
  body: string;
  /** A round's radius, a chamfer's longer leg or a hole's diameter, mm. */
  size: number;
  /** How many faces it has. */
  faces: number;
  /** Whether it was removed; false when its removal failed. */
  removed: boolean;
}

/**
 * What a simplification found and did (ADR-0141 §4). Derived, never stored:
 * the kernel's report, `FeatureStatus.simplify` and the dialog's preview
 * carry it.
 */
export interface SimplifyReport {
  groups: SimplifyGroup[];
  /**
   * Every size of each kind on the bodies, whatever the limits and toggles:
   * distinct to 0.001 mm (never rounded below a size), ascending, mm. The
   * dialog's sliders stop at these (ADR-0141 §4).
   */
  sizes: SimplifySizes;
}

/** Sizes per kind: rounds' radii, chamfers' longer legs, holes' diameters. */
export type SimplifySizes = Record<SimplifyGroup['kind'], number[]>;

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A group's line: "Hole Ø3 mm, 2 faces: removed". */
export function simplifyGroupLine(group: SimplifyGroup): string {
  const size = Number(group.size.toFixed(3));
  const what =
    group.kind === 'round'
      ? `Round R${size} mm`
      : group.kind === 'chamfer'
        ? `Chamfer ${size} mm`
        : `Hole Ø${size} mm`;
  return `${what}, ${plural(group.faces, 'face')}: ${group.removed ? 'removed' : "couldn't be removed"}`;
}
