/**
 * The print tolerance behind the Tolerance panel (P4-08, ADR-0062,
 * FR-3DP-05): the user parameter named `tolerance` (core's `setToleranceCommand`
 * makes the command), what it is worth, which of the three presets that is,
 * and what reaches it. Called from `AppShell` with the shell's parameter
 * `apply`, so every change is one command, which re-solves the sketches whose
 * dimensions it moves (ADR-0059) and undoes on its own.
 *
 * The panel itself (`TolerancePanel.tsx`) is plain markup like Print Info's.
 */
import {
  type Command,
  CommandError,
  type Dim,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  newId,
  type ParameterId,
  setToleranceCommand,
  TOLERANCE_PRESETS,
  type ToleranceUsage,
  toleranceParameter,
  toleranceUsage,
} from '@extrudo/core';
import { useCallback, useMemo, useState } from 'react';

/** Whether a result is a plain length (what a clearance is), not an area or an angle. */
const isLength = (dim: Dim) => dim.angle === 0 && dim.length === 1;

/** The session's `activeTool` while the panel is open. */
export const TOLERANCE_TOOL = 'tolerance';

/** What the panel shows about the document's tolerance. */
export interface ToleranceState {
  /** The parameter's expression as typed; empty while the document has none. */
  expression: string;
  /** Its value in mm, when there is one that evaluates to a length. */
  value: number | undefined;
  /** Which preset the value is, so its button reads as pressed. */
  preset: string | undefined;
  /** What reaches it, for the panel's line. */
  usage: ToleranceUsage;
  usageText: string;
}

/**
 * The panel's logic, as the document sees it (pure). `evaluation` is the
 * document's parameters, which the caller usually has already worked out.
 */
export function toleranceState(
  doc: ExtrudoDocument,
  evaluation = evaluateParameters(doc),
): ToleranceState {
  const parameter = toleranceParameter(doc);
  const result = parameter ? evaluation.parameters.get(parameter.name)?.result : undefined;
  const value = result?.ok && isLength(result.dim) ? result.value : undefined;
  const usage = toleranceUsage(doc);
  return {
    expression: parameter?.expression ?? '',
    value,
    preset: TOLERANCE_PRESETS.find((p) => p.value === value)?.id,
    usage,
    usageText: toleranceUsageText(usage),
  };
}

/** "Not used yet", "Used by 1 hole", "Used by 2 holes and 1 thread". */
export function toleranceUsageText({ holes, threads, other }: ToleranceUsage): string {
  const parts: string[] = [];
  if (holes > 0) parts.push(`${holes} ${holes === 1 ? 'hole' : 'holes'}`);
  if (threads > 0) parts.push(`${threads} ${threads === 1 ? 'thread' : 'threads'}`);
  if (other > 0) parts.push(`${other} other ${other === 1 ? 'expression' : 'expressions'}`);
  if (parts.length === 0) return 'Not used yet';
  const last = parts.pop();
  return `Used by ${parts.length === 0 ? last : `${parts.join(', ')} and ${last}`}`;
}

/** The expression a preset writes: what the buttons put in the field. */
export function tolerancePresetExpression(value: number): string {
  return `${value} mm`;
}

/**
 * The panel's write: creates the parameter or changes it, through `apply` (so
 * the sketches whose dimensions it moves re-solve, ADR-0059). Returns what a
 * refused command said, or undefined when it went through: one command, one
 * undo step.
 */
export function applyTolerance(
  doc: ExtrudoDocument,
  expression: string,
  apply: (command: Command<unknown>) => void,
): string | undefined {
  try {
    apply(setToleranceCommand(doc, expression, newId<ParameterId>()));
    return undefined;
  } catch (thrown) {
    if (!(thrown instanceof CommandError)) throw thrown;
    return thrown.message;
  }
}

export interface ToleranceOptions {
  doc: ExtrudoDocument;
  /**
   * Runs a command. The shell passes one that also re-solves the sketches
   * whose dimensions the change moves (ADR-0059); the parameters dialog's
   * own dispatch is the plain one.
   */
  apply(command: Command<unknown>): void;
}

export interface Tolerance extends ToleranceState {
  /** The document's units and precision, for the field's value. */
  settings: ExtrudoDocument['settings'];
  /** A draft expression's value against the document's parameters. */
  evaluate(expression: string): EvaluateResult;
  /** Creates the parameter or changes it: one command, one undo step. */
  set(expression: string): void;
  /** What a refused command said. */
  error: string | undefined;
}

/**
 * The panel's data and writes. Every write is a command (through `apply`); the
 * panel holds no state of its own but the last refusal's message, since the
 * document itself is what it shows.
 */
export function useTolerance({ doc, apply }: ToleranceOptions): Tolerance {
  const [error, setError] = useState<string>();
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const state = useMemo(() => toleranceState(doc, evaluation), [doc, evaluation]);
  const evaluate = useCallback(
    (expression: string) => evaluation.evaluate(expression, 'length'),
    [evaluation],
  );
  const set = useCallback(
    (expression: string) => setError(applyTolerance(doc, expression, apply)),
    [apply, doc],
  );
  return { ...state, settings: doc.settings, evaluate, set, error };
}
