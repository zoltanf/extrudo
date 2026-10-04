/**
 * The print tolerance (P4-08, ADR-0062, FR-3DP-05): how much room a printed
 * fit gets. It is a **user parameter** named `tolerance` (a length), not a
 * document setting, so every expression can see it (`diameter + 2 *
 * tolerance`), the Parameters dialog and the customizer list it, and the
 * thread feature of P4-02 already refers to it (`TOLERANCE_PARAMETER`, kept
 * here re-exported so there is one name).
 *
 * - `toleranceParameter` finds it, `setToleranceCommand` makes the one
 *   command that creates it or changes it (the caller makes the ID, as every
 *   command payload does), and `toleranceUsage` counts the expressions that
 *   mention it.
 * - `TOLERANCE_PRESETS` are the three allowances the Tolerance panel offers:
 *   Tight, Normal (a well-tuned printer's usual allowance), Loose.
 * - Hole presets write the tolerance into their diameters
 *   (`presetSizes` in `hole.ts`); everything else is left to the user.
 *
 * The tolerance is radial: a hole's diameter grows by twice it, a thread's
 * profile moves by once (P4-02). Deleting the parameter is the Parameters
 * dialog's job, and it refuses while anything uses it.
 */
import type { Command } from './commands';
import { addParameter, updateParameter } from './document-commands';
import { mentions } from './expr/parameters';
import { HOLE_TYPE } from './hole';
import type { ParameterId } from './ids';
import type { ExtrudoDocument, Parameter } from './schema';
import { THREAD_TYPE, TOLERANCE_PARAMETER } from './thread';

export { TOLERANCE_PARAMETER };

/** What the panel says about a parameter it creates. */
export const TOLERANCE_COMMENT = 'Print clearance: hole and thread presets use it';

/**
 * The three allowances the panel offers, in mm: printers need about 0.1 mm of
 * clearance each side for a snug fit, more when they run hot or extrude wide.
 */
export const TOLERANCE_PRESETS: readonly {
  id: string;
  label: string;
  /** mm. */
  value: number;
}[] = [
  { id: 'tight', label: 'Tight', value: 0.1 },
  { id: 'normal', label: 'Normal', value: 0.2 },
  { id: 'loose', label: 'Loose', value: 0.3 },
];

/**
 * The document's print tolerance parameter, when it has one. A parameter
 * named `tolerance` that isn't a length isn't it (the name alone would make
 * every hole's expression evaluate).
 */
export function toleranceParameter(doc: ExtrudoDocument): Parameter | undefined {
  return doc.parameters.find(
    (parameter) => parameter.name === TOLERANCE_PARAMETER && parameter.unit === 'length',
  );
}

/**
 * The command that makes the document's print tolerance `expression`: add the
 * parameter (with a comment saying what it is for) when there is none, else
 * change its expression. `id` is the new parameter's ID, made by the caller
 * (`newId()` in the UI, as every command payload does).
 *
 * One command, so one undo step: the panel's every change undoes on its own.
 */
export function setToleranceCommand(
  doc: ExtrudoDocument,
  expression: string,
  id: ParameterId,
): Command<unknown> {
  const parameter = toleranceParameter(doc);
  if (parameter) return updateParameter({ id: parameter.id, changes: { expression } });
  return addParameter({
    parameter: {
      id,
      name: TOLERANCE_PARAMETER,
      expression,
      unit: 'length',
      comment: TOLERANCE_COMMENT,
    },
  });
}

/** How much of the design the tolerance reaches. */
export interface ToleranceUsage {
  /** Hole features with a size that mentions `tolerance`. */
  holes: number;
  /** Thread features that do. */
  threads: number;
  /** Anything else: another feature's input, or another parameter's expression. */
  other: number;
}

/**
 * The features and parameters whose expressions mention `tolerance`, counted
 * by kind: what the panel tells the user their change reaches. A feature
 * counts once, whatever the number of its inputs that use the parameter.
 */
export function toleranceUsage(doc: ExtrudoDocument): ToleranceUsage {
  const usage: ToleranceUsage = { holes: 0, threads: 0, other: 0 };
  for (const feature of doc.features) {
    const uses = Object.values(feature.inputs).some(
      (input) => input.kind === 'expr' && mentions(input.expr, TOLERANCE_PARAMETER),
    );
    if (!uses) continue;
    if (feature.type === HOLE_TYPE) usage.holes += 1;
    else if (feature.type === THREAD_TYPE) usage.threads += 1;
    else usage.other += 1;
  }
  for (const parameter of doc.parameters) {
    if (parameter.name === TOLERANCE_PARAMETER) continue;
    if (mentions(parameter.expression, TOLERANCE_PARAMETER)) usage.other += 1;
  }
  return usage;
}
