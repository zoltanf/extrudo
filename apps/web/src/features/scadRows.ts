/**
 * An OpenSCAD import's overrides in the Import dialog (P5-04 slice 2,
 * ADR-0071 §5): one row per customizer variable of the `.scad` file, whose
 * text is an expression (`60`, `width`, `2 * wall`) or empty for the file's
 * own value. The rows are kept in the dialog's values as `exprs['scad:<name>']`
 * plus their order, `labels.scad` (the file's order, then any stored override
 * the file's list lacks), and become the numbered pairs `scadName<n>` /
 * `scadValue<n>` **packed**: an empty row makes no pair, and the pairs after it
 * move up, so the inputs never have a hole.
 *
 * A value's `unit` is what its expression is: a plain number is `unitless` (it
 * reaches OpenSCAD as it is), `width` a length, `30 deg` an angle (both in
 * OpenSCAD's mm and degrees). The schema requires it (file format §6.28).
 *
 * Pure: the component is `ScadOverrides.tsx`, the list comes from the kernel
 * (`KernelApi.scadParameters`) and is kept per file in `scadParameterStore`.
 */
import {
  type AttachmentId,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureInputs,
  type ImportInputs,
  SCAD_MAX_OVERRIDES,
  scadNameKey,
  scadOverrides,
  scadValueKey,
  type UnitKind,
} from '@extrudo/core';
import type { ScadParameter } from '@extrudo/kernel';
import { createStore } from 'zustand/vanilla';
import type { DialogIssue, DialogValues } from './spec';

/** The labels key of the rows' order. */
export const SCAD_ORDER = 'scad';

/** The `exprs` key of a variable's row. */
export const scadKey = (name: string) => `scad:${name}`;

/** What the dialog knows of a file's customizer variables. */
export type ScadParameterList =
  | { status: 'loading' }
  | { status: 'ready'; parameters: readonly ScadParameter[] }
  | { status: 'error'; error: string };

/**
 * The lists the kernel gave, by attachment. An attachment's bytes never change
 * under its ID (they are content-addressed, ADR-0061 §1), so a list is asked
 * for once per file and session.
 */
export const scadParameterStore = createStore<Record<AttachmentId, ScadParameterList>>()(
  () => ({}),
);

/** Whether a variable takes an override: a number (a vector or a string doesn't yet). */
export function isEditable(parameter: ScadParameter): boolean {
  return parameter.type === 'number' && typeof parameter.initial === 'number';
}

const evaluations = new WeakMap<ExtrudoDocument, ReturnType<typeof evaluateParameters>>();

/** The document's parameters, evaluated once per document (a row evaluates on every key). */
function evaluationOf(doc: ExtrudoDocument): ReturnType<typeof evaluateParameters> {
  let evaluation = evaluations.get(doc);
  if (!evaluation) {
    evaluation = evaluateParameters(doc);
    evaluations.set(doc, evaluation);
  }
  return evaluation;
}

/** Units in the order an expression is tried: a plain number is unitless first. */
const UNITS: readonly UnitKind[] = ['unitless', 'length', 'angle'];

/**
 * An override's expression, evaluated whatever its unit, with the unit it has:
 * the first of unitless, length and angle it evaluates as (a bare number is
 * unitless). A failure is the plain-number attempt's message.
 */
export function evaluateOverride(
  doc: ExtrudoDocument,
  expression: string,
): { result: EvaluateResult; unit?: UnitKind } {
  const evaluation = evaluationOf(doc);
  let first: EvaluateResult | undefined;
  for (const unit of UNITS) {
    const result = evaluation.evaluate(expression, unit);
    if (result.ok) return { result, unit };
    first ??= result;
  }
  // biome-ignore lint/style/noNonNullAssertion: UNITS is not empty.
  return { result: first! };
}

/** The rows' variables in order: the file's, then stored ones the file's list lacks. */
export function rowOrder(
  parameters: readonly ScadParameter[] | undefined,
  stored: readonly string[],
): string[] {
  const order = (parameters ?? []).filter(isEditable).map((p) => p.name);
  for (const name of stored) if (!order.includes(name)) order.push(name);
  return order;
}

/** The overrides as the rows hold them: the order and each row's text. */
export function overrideValues(inputs: FeatureInputs): Partial<DialogValues> {
  const exprs: Record<string, string> = {};
  const order: string[] = [];
  for (const override of scadOverrides(inputs as ImportInputs)) {
    if (override.name === undefined) continue;
    const value = override.value ? inputs[override.value] : undefined;
    exprs[scadKey(override.name)] = value?.kind === 'expr' ? value.expr : '';
    order.push(override.name);
  }
  return { exprs, labels: { [SCAD_ORDER]: order } };
}

/**
 * The pairs the rows make, packed in the rows' order: an empty row makes none.
 * A text that doesn't evaluate keeps the plain-number unit, and `validate`
 * says what is wrong with it.
 */
export function overrideInputs(
  values: DialogValues,
  doc: ExtrudoDocument,
): Record<string, ImportInputs[string]> {
  const inputs: Record<string, ImportInputs[string]> = {};
  let n = 0;
  for (const name of values.labels[SCAD_ORDER] ?? []) {
    const text = values.exprs[scadKey(name)]?.trim() ?? '';
    if (text === '' || n >= SCAD_MAX_OVERRIDES) continue;
    n++;
    const unit = evaluateOverride(doc, text).unit ?? 'unitless';
    inputs[scadNameKey(n)] = { kind: 'enum', value: name };
    inputs[scadValueKey(n)] = { kind: 'expr', expr: text, unit };
  }
  return inputs;
}

/** The first row whose text doesn't evaluate, or more rows than the inputs hold. */
export function overrideIssue(values: DialogValues, doc: ExtrudoDocument): DialogIssue | undefined {
  let filled = 0;
  for (const name of values.labels[SCAD_ORDER] ?? []) {
    const text = values.exprs[scadKey(name)]?.trim() ?? '';
    if (text === '') continue;
    filled++;
    const { result } = evaluateOverride(doc, text);
    if (!result.ok) return { message: `${name}: ${result.error.message}` };
  }
  if (filled > SCAD_MAX_OVERRIDES) {
    return {
      message: `An import can override ${SCAD_MAX_OVERRIDES} variables; ${filled} are set. Clear some.`,
    };
  }
  return undefined;
}
