/**
 * Field values and the draft feature (ADR-0027): defaults, the default
 * mapping between fields and inputs, model parameter names, the checks
 * that keep OK disabled, and expression evaluation in the context of the
 * draft. Pure functions over the spec and the document.
 */
import {
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type Feature,
  type FeatureId,
  type FeatureInputs,
  type GeomRef,
  type GeomRefKind,
  type Input,
  parameterNames,
} from '@extrudo/core';
import type {
  DialogContext,
  DialogField,
  DialogIssue,
  DialogValues,
  FeatureDialogSpec,
} from './spec';

export const EMPTY_VALUES: DialogValues = { refs: {}, exprs: {}, choices: {}, toggles: {} };

/** Every field at its default: selection fields empty. */
export function defaultValues(spec: FeatureDialogSpec): DialogValues {
  const values = { refs: {}, exprs: {}, choices: {}, toggles: {} } as {
    [K in keyof DialogValues]: Record<string, DialogValues[K][string]>;
  };
  for (const field of spec.fields) {
    if (field.kind === 'selection') values.refs[field.name] = [];
    else if (field.kind === 'expression') values.exprs[field.name] = field.default;
    else if (field.kind === 'choice') values.choices[field.name] = field.default;
    else values.toggles[field.name] = field.default;
  }
  return values;
}

/** `base` with the values in `more` put over it. */
export function mergeValues(base: DialogValues, more: Partial<DialogValues>): DialogValues {
  return {
    refs: { ...base.refs, ...more.refs },
    exprs: { ...base.exprs, ...more.exprs },
    choices: { ...base.choices, ...more.choices },
    toggles: { ...base.toggles, ...more.toggles },
  };
}

/** The fields whose value in `more` differs from `base` (refs compared by kind and ID). */
export function changedFields(base: DialogValues, more: Partial<DialogValues>): string[] {
  const changed: string[] = [];
  for (const kind of ['refs', 'exprs', 'choices', 'toggles'] as const) {
    for (const [field, value] of Object.entries(more[kind] ?? {})) {
      if (JSON.stringify(value) !== JSON.stringify(base[kind][field])) changed.push(field);
    }
  }
  return changed;
}

/** Only the named fields of some values. */
export function pickFields(values: Partial<DialogValues>, fields: readonly string[]) {
  const keep = new Set(fields);
  const out: Partial<DialogValues> = {};
  for (const kind of ['refs', 'exprs', 'choices', 'toggles'] as const) {
    const entries = Object.entries(values[kind] ?? {}).filter(([field]) => keep.has(field));
    if (entries.length > 0) (out as Record<string, unknown>)[kind] = Object.fromEntries(entries);
  }
  return out;
}

/** The fields shown for these values, in the spec's order. */
export function shownFields(spec: FeatureDialogSpec, values: DialogValues): DialogField[] {
  return spec.fields.filter((field) => field.shown?.(values) ?? true);
}

/** One input per shown field, named like it (the default `toInputs`). */
export function defaultInputs(spec: FeatureDialogSpec, values: DialogValues): FeatureInputs {
  const inputs: FeatureInputs = {};
  for (const field of shownFields(spec, values)) {
    const input = fieldInput(field, values);
    if (input) inputs[field.name] = input;
  }
  return inputs;
}

function fieldInput(field: DialogField, values: DialogValues): Input | undefined {
  switch (field.kind) {
    case 'selection':
      return { kind: 'ref', refs: [...(values.refs[field.name] ?? [])] };
    case 'expression':
      return { kind: 'expr', expr: values.exprs[field.name] ?? field.default, unit: field.unit };
    case 'choice':
      return { kind: 'enum', value: values.choices[field.name] ?? field.default };
    case 'toggle':
      return { kind: 'bool', value: values.toggles[field.name] ?? field.default };
  }
}

/** The values stored in inputs named like the fields (the default `fromInputs`). */
export function defaultFromInputs(
  spec: FeatureDialogSpec,
  inputs: FeatureInputs,
): Partial<DialogValues> {
  const refs: Record<string, GeomRef[]> = {};
  const exprs: Record<string, string> = {};
  const choices: Record<string, string> = {};
  const toggles: Record<string, boolean> = {};
  for (const field of spec.fields) {
    const input = inputs[field.name];
    if (field.kind === 'selection' && input?.kind === 'ref') refs[field.name] = [...input.refs];
    else if (field.kind === 'expression' && input?.kind === 'expr') exprs[field.name] = input.expr;
    else if (field.kind === 'choice' && input?.kind === 'enum') choices[field.name] = input.value;
    else if (field.kind === 'toggle' && input?.kind === 'bool') toggles[field.name] = input.value;
  }
  return { refs, exprs, choices, toggles };
}

/** A spec's inputs for the values: its own `toInputs`, or the default mapping. */
export function inputsFor(
  spec: FeatureDialogSpec,
  values: DialogValues,
  ctx: DialogContext,
): FeatureInputs {
  return spec.toInputs ? spec.toInputs(values, ctx) : defaultInputs(spec, values);
}

/** A spec's values for a stored feature: defaults, then what its inputs say. */
export function valuesFor(
  spec: FeatureDialogSpec,
  feature: Feature,
  ctx: DialogContext,
): DialogValues {
  const stored = spec.fromInputs
    ? spec.fromInputs(feature.inputs, ctx)
    : defaultFromInputs(spec, feature.inputs);
  return mergeValues(defaultValues(spec), stored);
}

/**
 * Gives every `expr` input a model parameter name (`d7`, architecture
 * §4.3): the one `names` holds for that input, else a new one, one higher
 * than any `dN` in the document or in `names`. Returns the inputs and the
 * names, extended; names are kept for the whole dialog, so a preview and
 * the committed feature are the same (and OK hits the kernel's cache).
 */
export function withParameterNames(
  inputs: FeatureInputs,
  names: Readonly<Record<string, string>>,
  doc: ExtrudoDocument,
  own?: FeatureId,
): { inputs: FeatureInputs; names: Record<string, string> } {
  const out: FeatureInputs = {};
  const next = { ...names };
  const taken = parameterNames(own ? withoutFeature(doc, own) : doc);
  let highest = 0;
  for (const name of [...taken, ...Object.values(next)]) {
    const match = /^d(\d+)$/.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  for (const [key, input] of Object.entries(inputs)) {
    if (input.kind !== 'expr' || input.paramName) {
      out[key] = input;
      continue;
    }
    let name = next[key];
    if (!name || taken.has(name)) {
      name = `d${++highest}`;
      next[key] = name;
    }
    out[key] = { ...input, paramName: name };
  }
  return { inputs: out, names: next };
}

function withoutFeature(doc: ExtrudoDocument, id: FeatureId): ExtrudoDocument {
  return { ...doc, features: doc.features.filter((f) => f.id !== id) };
}

/** The model parameter names an existing feature's `expr` inputs have. */
export function storedParameterNames(feature: Feature): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [key, input] of Object.entries(feature.inputs)) {
    if (input.kind === 'expr' && input.paramName) names[key] = input.paramName;
  }
  return names;
}

/**
 * The document with the draft in its place: inserted at `index` (a new
 * feature) or replacing the feature with its ID (editing). For evaluating
 * the draft's expressions in context: its own parameters, cycles.
 */
export function withDraft(doc: ExtrudoDocument, draft: Feature, index: number): ExtrudoDocument {
  const at = doc.features.findIndex((f) => f.id === draft.id);
  const features = [...doc.features];
  if (at >= 0) features[at] = draft;
  else features.splice(index, 0, draft);
  return { ...doc, features };
}

/** The results of the draft's `expr` inputs, by input name. */
export function draftExpressions(
  doc: ExtrudoDocument,
  draft: Feature,
  index: number,
): ReadonlyMap<string, EvaluateResult> {
  return evaluateParameters(withDraft(doc, draft, index)).inputs.get(draft.id) ?? new Map();
}

const NOUNS: Record<GeomRefKind, [string, string]> = {
  plane: ['plane', 'planes'],
  axis: ['axis', 'axes'],
  point: ['point', 'points'],
  face: ['face', 'faces'],
  edge: ['edge', 'edges'],
  vertex: ['vertex', 'vertices'],
  profile: ['profile', 'profiles'],
  body: ['body', 'bodies'],
  sketchEntity: ['sketch curve', 'sketch curves'],
};

/** "face", "profile or face": what a field takes, for its messages. */
export function acceptsNoun(kinds: readonly GeomRefKind[], plural = false): string {
  const words = kinds.map((k) => NOUNS[k][plural ? 1 : 0]);
  return words.length <= 1
    ? (words[0] ?? 'item')
    : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
}

const article = (noun: string) => (/^[aeiou]/.test(noun) ? 'an' : 'a');

/** What an empty selection field asks for: its `prompt`, or "Pick a face". */
export function pickPrompt(field: Extract<DialogField, { kind: 'selection' }>): string {
  if (field.prompt) return field.prompt;
  const noun = acceptsNoun(field.accepts);
  return `Pick ${article(noun)} ${noun}`;
}

/**
 * The problem with a selection field's count, if any: "Pick a face.",
 * "Pick at least 2 edges.", "Pick at most 1 profile."
 */
export function countIssue(
  field: Extract<DialogField, { kind: 'selection' }>,
  count: number,
): string | undefined {
  const min = field.min ?? 1;
  const max = field.max ?? Number.POSITIVE_INFINITY;
  if (count < min) {
    if (min === 1) return `${pickPrompt(field)}.`;
    return `Pick at least ${min} ${acceptsNoun(field.accepts, true)}.`;
  }
  if (count > max) {
    return `Pick at most ${max} ${acceptsNoun(field.accepts, max !== 1)}.`;
  }
  return undefined;
}

export interface Checked {
  /** Problems by field name, shown under the field (expression fields show their own). */
  fields: Record<string, string>;
  /** The first problem overall, for the dialog and OK's tooltip. */
  first: DialogIssue | undefined;
}

/**
 * Everything that keeps OK disabled: selection counts, expressions that
 * don't evaluate (by the input named like the field), refs a field doesn't
 * accept, and the spec's own `validate`. Only shown fields count.
 */
export function checkValues(
  spec: FeatureDialogSpec,
  values: DialogValues,
  expressions: ReadonlyMap<string, EvaluateResult>,
  ctx: DialogContext,
): Checked {
  const fields: Record<string, string> = {};
  const issues: DialogIssue[] = [];
  for (const field of shownFields(spec, values)) {
    let message: string | undefined;
    if (field.kind === 'selection') {
      const refs = values.refs[field.name] ?? [];
      message = countIssue(field, refs.length);
      if (!message && refs.some((r) => !field.accepts.includes(r.kind))) {
        message = `Pick only ${acceptsNoun(field.accepts, true)}.`;
      }
    } else if (field.kind === 'expression') {
      // The field itself underlines and explains it (`<ExpressionInput>`).
      const result = expressions.get(field.name);
      if (result && !result.ok) {
        issues.push({ message: `${field.label}: ${result.error.message}`, field: field.name });
      }
    }
    if (message) {
      fields[field.name] = message;
      issues.push({ message, field: field.name });
    }
  }
  const own = spec.validate?.(values, ctx);
  if (own) {
    if (own.field && !fields[own.field]) fields[own.field] = own.message;
    issues.push(own);
  }
  return { fields, first: issues[0] };
}
