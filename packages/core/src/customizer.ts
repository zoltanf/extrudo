/**
 * The customizer and configurations (P4-07, ADR-0059 §1 to §3, FR-PAR-05 and
 * -06): the few parameters a design exposes for changing, and the named value
 * sets to switch between.
 *
 * **Exposed parameters.** A parameter with a `customizer` object is shown in
 * the panel, in document order, grouped by the parameter's `group` (groups in
 * order of first appearance, ungrouped parameters first): `customizerRows`.
 * `min`, `max` and `step` are expressions in the parameter's unit (ADR-0086
 * §2), evaluated by `evaluateRange`: the slider's range, not a constraint; a
 * value outside it is allowed and the row says so.
 *
 * **Configurations.** A configuration is a name and a set of parameter
 * expressions. Applying one goes through the app's parameter-change path, so
 * the sketches whose dimensions use a parameter are re-solved in the same undo
 * step (ADR-0016); `configurationChanges` is what that path takes. Nothing
 * stores which configuration is "active": one goes stale after any edit or
 * undo, so `currentConfigurations` matches the values instead (equal after
 * trimming, since whitespace is insignificant in an expression).
 *
 * The commands validate through the schema (`schema.ts`) and refuse a duplicate
 * configuration name with a `CommandError`, so a rejected change leaves the
 * document alone.
 */
import type { z } from 'zod';
import { CommandError, type DocumentDraft, defineCommand } from './commands';
import { ExprError } from './expr/errors';
import { type EvaluateResult, isReservedName } from './expr/evaluate';
import { evaluateParameters, findRef, type ParameterEvaluation } from './expr/parameters';
import { type Node, parse, references } from './expr/parser';
import type { ConfigurationId, ParameterId } from './ids';
import type { Configuration, Customizer, ExtrudoDocument, Parameter, UnitKind } from './schema';
import {
  ConfigurationValuesSchema,
  CustomizerSchema,
  ParameterGroupSchema,
  sameConfigurationName,
} from './schema';

/** The parts of a slider range, in the order the dialog shows them. */
export const RANGE_FIELDS = ['min', 'step', 'max'] as const;
export type RangeField = (typeof RANGE_FIELDS)[number];

const RANGE_LABELS: Record<RangeField, string> = { min: 'Min', max: 'Max', step: 'Step' };

/**
 * Exposes a parameter in the customizer, or takes it out again by leaving
 * `customizer` out (ADR-0059 §1). One undo step. Each range field is an
 * expression in the parameter's unit (ADR-0086 §2); an empty one is left out.
 * Refused: a field that doesn't evaluate, that uses the parameter or one that
 * depends on it, a step that isn't positive, and a min above the max.
 */
export const setParameterCustomizer = defineCommand<{
  id: ParameterId;
  /** Absent removes the parameter from the customizer. */
  customizer?: Customizer;
}>('parameter.customizer', 'Change customizer', (draft, { id, customizer }) => {
  const parameter = findParameter(draft, id);
  if (customizer === undefined) {
    delete parameter.customizer;
    return;
  }
  const given = validate(CustomizerSchema, customizer, 'The customizer settings are not valid:');
  const range: Customizer = {};
  for (const field of RANGE_FIELDS) {
    const text = given[field]?.trim();
    if (text) range[field] = text;
  }
  const evaluation = evaluateParameters(draft as ExtrudoDocument);
  const values: Partial<Record<RangeField, number>> = {};
  for (const field of RANGE_FIELDS) {
    const text = range[field];
    if (text === undefined) continue;
    const result = evaluateRange(evaluation, parameter, field, text);
    if (!result.ok) throw new CommandError(`${RANGE_LABELS[field]}: ${result.error.message}`);
    values[field] = result.value;
  }
  if (values.min !== undefined && values.max !== undefined && values.min > values.max) {
    throw new CommandError(`Min ${range.min} can't be above max ${range.max}.`);
  }
  parameter.customizer = range;
});

/**
 * What a slider range field evaluates to (ADR-0086 §2): the expression in the
 * parameter's unit, against the other parameters' current values. Beyond the
 * expression's own errors, a range must not use the parameter or a parameter
 * that depends on it (dragging the slider would move the range), and a step
 * must be positive.
 */
export function evaluateRange(
  evaluation: ParameterEvaluation,
  parameter: Pick<Parameter, 'name' | 'unit'>,
  field: RangeField,
  expression: string,
): EvaluateResult {
  const result = evaluation.evaluate(expression, parameter.unit);
  if (!result.ok) return result;
  const node = parse(expression);
  const moving = evaluation.dependents([parameter.name]);
  moving.add(parameter.name);
  for (const name of references(node)) {
    if (isReservedName(name) || !moving.has(name)) continue;
    const span = findRef(node, name) ?? node.span;
    const message =
      name === parameter.name
        ? `The range can't use \`${name}\` itself.`
        : `The range can't use \`${name}\`: it changes with \`${parameter.name}\`.`;
    return { ok: false, error: new ExprError(message, span) };
  }
  if (field === 'step' && result.value <= 0) {
    return { ok: false, error: new ExprError('The step must be above 0.', node.span) };
  }
  return result;
}

/**
 * Puts a parameter in a group, or takes it out of its group with an empty or
 * absent `group` (ADR-0086 §1). One undo step. The name is trimmed, 1 to 40
 * characters.
 */
export const setParameterGroup = defineCommand<{ id: ParameterId; group?: string }>(
  'parameter.group',
  'Change group',
  (draft, { id, group }) => {
    const parameter = findParameter(draft, id);
    const name = group?.trim();
    if (!name) {
      delete parameter.group;
      return;
    }
    parameter.group = validate(ParameterGroupSchema, name, 'The group name is not valid:');
  },
);

/**
 * Moves a parameter to `index` in the list (ADR-0086 §3), the position it ends
 * up at, and with `group` also into that group (`null` takes it out of its
 * group): what a drag in the Parameters dialog does, in one undo step. The
 * order is the dialog's order and the customizer panel's; it never changes
 * what an expression evaluates to.
 */
export const moveParameter = defineCommand<{
  id: ParameterId;
  index: number;
  group?: string | null;
}>('parameter.move', 'Move parameter', (draft, { id, index, group }) => {
  const parameter = findParameter(draft, id);
  if (!Number.isInteger(index) || index < 0 || index >= draft.parameters.length) {
    throw new CommandError(`There is no position ${index} in the parameter list.`);
  }
  if (group === null) delete parameter.group;
  else if (group !== undefined) {
    parameter.group = validate(ParameterGroupSchema, group.trim(), 'The group name is not valid:');
  }
  const from = draft.parameters.findIndex((p) => p.id === id);
  const [moved] = draft.parameters.splice(from, 1);
  draft.parameters.splice(index, 0, moved as Parameter);
});

/**
 * Saves a configuration: its ID and name come from the caller (`newId`), its
 * values from `capturedValues`. One undo step.
 */
export const addConfiguration = defineCommand<{ configuration: Configuration }>(
  'configuration.add',
  'Save configuration',
  (draft, { configuration }) => {
    if (draft.configurations?.some((c) => c.id === configuration.id)) {
      throw new CommandError(`Configuration ${configuration.id} already exists.`);
    }
    draft.configurations = [
      ...(draft.configurations ?? []),
      {
        id: configuration.id,
        name: configurationName(draft, configuration.name),
        values: validate(
          ConfigurationValuesSchema,
          configuration.values,
          "The configuration's values are not valid:",
        ),
      },
    ];
  },
);

/**
 * Renames a configuration, replaces its values (what "Update" captures), or
 * both. One undo step.
 */
export const updateConfiguration = defineCommand<{
  id: ConfigurationId;
  changes: { name?: string; values?: Record<ParameterId, string> };
}>('configuration.update', 'Edit configuration', (draft, { id, changes }) => {
  const configuration = findConfiguration(draft, id);
  if (changes.name !== undefined) configuration.name = configurationName(draft, changes.name, id);
  if (changes.values !== undefined) {
    configuration.values = validate(
      ConfigurationValuesSchema,
      changes.values,
      "The configuration's values are not valid:",
    );
  }
});

/** Deletes a configuration. One undo step. Parameters keep their values. */
export const removeConfiguration = defineCommand<{ id: ConfigurationId }>(
  'configuration.remove',
  'Delete configuration',
  (draft, { id }) => {
    findConfiguration(draft, id);
    draft.configurations = (draft.configurations ?? []).filter((c) => c.id !== id);
  },
);

/**
 * Sets several parameter expressions at once, as applying a configuration does
 * (ADR-0059 §2): one command, so one undo step, and the app sends it through
 * its parameter-change path, which re-solves the sketches whose dimensions use
 * the parameters (ADR-0016).
 *
 * Every parameter must exist, as for `updateParameter`; the expression itself
 * is the caller's to have checked, since `updateParameter` takes one the same
 * way. A refused change leaves the document alone (Immer drops the draft).
 */
export const setParameterExpressions = defineCommand<{
  changes: { id: ParameterId; expression: string }[];
}>('parameter.expressions', 'Set parameter values', (draft, { changes }) => {
  for (const change of changes) findParameter(draft, change.id).expression = change.expression;
});

/**
 * Is the expression a plain value: one number with an optional unit (`12`,
 * `12 mm`, `-3.5 deg`, `0.5 in`)? Only those can be dragged with a slider
 * (ADR-0059 §1); a formula shows its computed value read-only and can still be
 * typed.
 */
export function isPlainValue(expression: string): boolean {
  let node: Node;
  try {
    node = parse(expression.trim());
  } catch {
    return false;
  }
  return isPlainNode(node);
}

function isPlainNode(node: Node): boolean {
  return node.kind === 'num' || (node.kind === 'unary' && isPlainNode(node.arg));
}

/** One exposed parameter, as the customizer panel shows it (ADR-0059 §1). */
export interface CustomizerRow {
  id: ParameterId;
  /** The parameter's name, which is what an expression refers to it by. */
  name: string;
  /** The parameter's comment, which the panel shows as the row's hint. */
  comment: string | undefined;
  /** The panel heading; absent for a parameter without a group. */
  group: string | undefined;
  unit: UnitKind;
  /** The stored expression, verbatim: the field's text, and a formula's hint. */
  expression: string;
  /** What it evaluates to in the base unit; absent while it has no value. */
  value: number | undefined;
  /** Whether `expression` is a plain value, so the row can have a slider. */
  plain: boolean;
  /** The slider's range and step, in the base unit. A row without both ends has no slider. */
  min?: number;
  max?: number;
  step?: number;
  /** The value is outside `[min, max]` where the row has one: warn, don't refuse. */
  outOfRange: boolean;
}

/**
 * The exposed parameters in panel order (ADR-0059 §1): ungrouped parameters
 * first, then each group in order of first appearance, each group in document
 * order.
 *
 * `evaluation` is the document's (`evaluateParameters(doc)`): a parameter
 * whose expression has an error has no value. A range field that doesn't
 * evaluate (`evaluateRange`) is left out, and so are both ends when the min is
 * above the max, so the row has no slider rather than a wrong one.
 */
export function customizerRows(
  doc: ExtrudoDocument,
  evaluation: ParameterEvaluation,
): CustomizerRow[] {
  const rows: CustomizerRow[] = [];
  for (const parameter of doc.parameters) {
    const customizer = parameter.customizer;
    if (!customizer) continue;
    const result = evaluation.parameters.get(parameter.name)?.result;
    const value = result?.ok === true ? result.value : undefined;
    const range: Partial<Record<RangeField, number>> = {};
    for (const field of RANGE_FIELDS) {
      const text = customizer[field];
      if (text === undefined) continue;
      const end = evaluateRange(evaluation, parameter, field, text);
      if (end.ok) range[field] = end.value;
    }
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
      delete range.min;
      delete range.max;
    }
    const { min, max, step } = range;
    rows.push({
      id: parameter.id,
      name: parameter.name,
      comment: parameter.comment,
      group: parameter.group,
      unit: parameter.unit,
      expression: parameter.expression,
      value,
      plain: isPlainValue(parameter.expression),
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      ...(step === undefined ? {} : { step }),
      outOfRange:
        value !== undefined &&
        ((min !== undefined && value < min) || (max !== undefined && value > max)),
    });
  }
  const ungrouped = rows.filter((row) => row.group === undefined);
  const grouped = rows.filter((row) => row.group !== undefined);
  return [...ungrouped, ...groupsOf(grouped)];
}

/** The grouped rows, grouped by first appearance, each group in document order. */
function groupsOf(rows: readonly CustomizerRow[]): CustomizerRow[] {
  const order: string[] = [];
  for (const row of rows) {
    const group = row.group as string;
    if (!order.includes(group)) order.push(group);
  }
  return order.flatMap((group) => rows.filter((row) => row.group === group));
}

/**
 * What applying a configuration changes: the parameters it lists that still
 * exist and whose expression differs (equal after trimming), so applying a
 * configuration that is already current does nothing. An unknown configuration
 * has nothing to apply. The app feeds the result to the parameter-change path,
 * which re-solves the sketches that use the parameters (ADR-0016).
 */
export function configurationChanges(
  doc: ExtrudoDocument,
  id: ConfigurationId,
): { id: ParameterId; expression: string }[] {
  const configuration = doc.configurations?.find((c) => c.id === id);
  if (!configuration) return [];
  const changes: { id: ParameterId; expression: string }[] = [];
  for (const parameter of doc.parameters) {
    const expression = configuration.values[parameter.id];
    if (expression === undefined || same(expression, parameter.expression)) continue;
    changes.push({ id: parameter.id, expression });
  }
  return changes;
}

/**
 * The configurations whose values the document has, in document order
 * (ADR-0059 §2): every value they list that still exists equals the
 * parameter's expression. A configuration that lists only parameters that are
 * gone matches trivially — applying it changes nothing.
 */
export function currentConfigurations(doc: ExtrudoDocument): ConfigurationId[] {
  const matches = (configuration: Configuration): boolean =>
    doc.parameters.every(
      (parameter) =>
        configuration.values[parameter.id] === undefined ||
        same(configuration.values[parameter.id] as string, parameter.expression),
    );
  return (doc.configurations ?? []).filter(matches).map((c) => c.id);
}

/**
 * The values to store for a configuration: the current expressions of the
 * exposed parameters. With `base`, that configuration's own parameters come
 * first and are brought up to date too, which is what "Update" does after a
 * parameter has been exposed since; an unknown `base` saves a new
 * configuration's values.
 */
export function capturedValues(
  doc: ExtrudoDocument,
  base?: ConfigurationId,
): Record<ParameterId, string> {
  const configuration = base === undefined ? undefined : configurationOf(doc, base);
  const captured: Record<ParameterId, string> = {};
  for (const parameter of doc.parameters) {
    if (configuration?.values[parameter.id] !== undefined) {
      captured[parameter.id] = parameter.expression;
    }
  }
  for (const parameter of doc.parameters) {
    if (parameter.customizer) captured[parameter.id] = parameter.expression;
  }
  return captured;
}

/** Two expressions are the same value when they read the same (whitespace aside). */
function same(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

function configurationOf(doc: ExtrudoDocument, id: ConfigurationId): Configuration | undefined {
  return doc.configurations?.find((c) => c.id === id);
}

function findParameter(draft: DocumentDraft, id: ParameterId) {
  const parameter = draft.parameters.find((p) => p.id === id);
  if (!parameter) throw new CommandError(`Parameter ${id} doesn't exist.`);
  return parameter;
}

function findConfiguration(draft: DocumentDraft, id: ConfigurationId) {
  const configuration = draft.configurations?.find((c) => c.id === id);
  if (!configuration) throw new CommandError(`Configuration ${id} doesn't exist.`);
  return configuration;
}

/** A configuration's name: trimmed, not empty, not too long, and not another's. */
function configurationName(draft: DocumentDraft, name: string, except?: ConfigurationId): string {
  const trimmed = name.trim();
  if (!trimmed) throw new CommandError("The configuration's name can't be empty.");
  if (trimmed.length > 60) {
    throw new CommandError(
      `The name can't be longer than 60 characters (this one is ${trimmed.length}).`,
    );
  }
  const taken = (draft.configurations ?? []).some(
    (c) => c.id !== except && sameConfigurationName(c.name, trimmed),
  );
  if (taken) throw new CommandError(`A configuration named "${trimmed}" already exists.`);
  return trimmed;
}

/** Validates through a schema, refusing the command with the first problem worded. */
function validate<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.length ? `\`${issue.path.join('.')}\` ` : '';
  throw new CommandError(`${what} ${field}${issue?.message ?? "isn't valid."}`.trimEnd());
}
