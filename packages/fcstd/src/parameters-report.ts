/**
 * The parameters part of the import's report (ADR-0144 S10): the user
 * parameters that came in, the cells and variables that didn't, every
 * expression of the file with its one outcome, and the names that changed.
 * Plain data; the app words it (`fcstdNotices`).
 */
import { type ExtrudoDocument, parameterNames } from '@extrudo/core';
import type { Binder } from './bind';
import type { ExpressionReason } from './fc-emit';
import type {
  ImportedParameter,
  NameChange,
  ParameterKind,
  ParameterLeftOut,
  PreparedParameters,
  TargetKind,
} from './params';

/** One `ExpressionEngine` entry of the file and what became of it. */
export interface ExpressionOutcome {
  /** The owner's internal name, the bound path and the expression, as stored. */
  readonly object: string;
  readonly path: string;
  readonly expression: string;
  readonly target: TargetKind;
  /** `kept`: it came in live; otherwise why the stored number came in instead (or nothing, `unmapped`). */
  readonly outcome: 'kept' | ExpressionReason;
  /** The Extrudo text it came in as. */
  readonly text?: string;
  readonly detail?: string;
  /**
   * What it sets came in, holding the file's number: a dimension, an input or
   * a plane's distance the walk added. Only these are "plain numbers" in the
   * app's notice; any other target (a property Extrudo has no counterpart
   * for, an object that came in as a shape only) is in no number of the design.
   */
  readonly number?: true;
}

export interface ParametersReport {
  readonly parameters: readonly ImportedParameter[];
  readonly leftOut: readonly ParameterLeftOut[];
  readonly expressions: readonly ExpressionOutcome[];
  readonly renames: readonly NameChange[];
  /** The rule's rounds over the whole import. */
  readonly rounds: number;
}

/** The report; `doc` is the design at the end, so only the names that came in count as changed. */
export function parametersReport(
  p: PreparedParameters,
  binder: Binder,
  doc: ExtrudoDocument,
): ParametersReport {
  const names = parameterNames(doc);
  return {
    parameters: p.parameters,
    leftOut: p.leftOut,
    expressions: p.entries.map((e) => ({
      object: e.owner.name,
      path: e.path,
      expression: e.text,
      target: e.target,
      outcome: e.outcome?.outcome ?? 'unmapped',
      ...(e.outcome?.text !== undefined ? { text: e.outcome.text } : {}),
      ...(e.outcome?.detail !== undefined ? { detail: e.outcome.detail } : {}),
      ...(e.outcome?.number ? { number: true as const } : {}),
    })),
    renames: p.names.changes.filter((c) => names.has(c.to)),
    rounds: binder.rounds,
  };
}

/** Counts for a report: parameters by source and kind, expressions by target and outcome. */
export function parameterCounts(r: ParametersReport) {
  const parameters: Record<string, Record<ParameterKind, number>> = Object.create(null);
  for (const x of r.parameters) {
    parameters[x.source] ??= { length: 0, angle: 0, unitless: 0 };
    (parameters[x.source] as Record<ParameterKind, number>)[x.kind]++;
  }
  const expressions: Record<string, Record<string, number>> = Object.create(null);
  for (const e of r.expressions) {
    const row: Record<string, number> = expressions[e.target] ?? Object.create(null);
    expressions[e.target] = row;
    row[e.outcome] = (row[e.outcome] ?? 0) + 1;
  }
  const kept = r.expressions.filter((e) => e.outcome === 'kept').length;
  return {
    parameters,
    expressions,
    kept,
    numbers: r.expressions.filter((e) => e.outcome !== 'kept' && e.number).length,
    renames: r.renames.length,
  };
}
