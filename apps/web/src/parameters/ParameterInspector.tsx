import {
  addParameter,
  type Command,
  type EvaluatedParameter,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  evaluateRange,
  formatQuantity,
  isPlainValue,
  newId,
  type Parameter,
  type ParameterEvaluation,
  type ParameterId,
  type ParameterUse,
  parameterUsers,
  RANGE_FIELDS,
  type RangeField,
  removeParameter,
  setParameterCustomizer,
  setParameterGroup,
  type UnitKind,
  updateFeatureInputs,
  updateParameter,
  updateSketchDimension,
} from '@extrudo/core';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react';
import { Button, IconButton, TextInput } from '../design-system';
import { withRangeField } from './customizer';
import { withDimensionExpr } from './drafts';
import { ExpressionInput } from './ExpressionInput';
import { featureName, groupNames, labelOfUse, starCommand } from './list';

/** What the dialog's right side shows. */
export type Selection =
  | { kind: 'user'; id: ParameterId }
  | { kind: 'model'; name: string }
  | { kind: 'new' };

type Run = (command: Command<unknown>) => boolean;

const UNITS: [UnitKind, string][] = [
  ['length', 'Length'],
  ['angle', 'Angle'],
  ['unitless', 'Number'],
];

const RANGE_LABELS: Record<RangeField, string> = { min: 'Min', max: 'Max', step: 'Step' };

/** An empty range field: valid, so it commits (and takes that end away). */
const EMPTY: EvaluateResult = { ok: true, value: 0, dim: { length: 0, angle: 0 } };

const formatOf = (doc: ExtrudoDocument) => (r: Extract<EvaluateResult, { ok: true }>) =>
  formatQuantity(r.value, r.dim, doc.settings);

/**
 * A user parameter's settings (ADR-0086): name, unit, expression, comment,
 * group, what uses it, and its customizer slider. Formulas are kept as typed
 * everywhere, the slider range included.
 */
export function UserInspector({
  doc,
  evaluation,
  parameter,
  run,
  onSelect,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  doc: ExtrudoDocument;
  evaluation: ParameterEvaluation;
  parameter: Parameter;
  run: Run;
  onSelect(selection: Selection): void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove(direction: -1 | 1): void;
}) {
  const { id, name } = parameter;
  const format = formatOf(doc);
  const uses = useMemo(() => parameterUsers(doc, name), [doc, name]);
  return (
    <div className="flex min-h-full flex-col gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <Field label="Name">
          <TextField
            label={`Name of ${name}`}
            value={name}
            className="h-9 font-mono text-md"
            onCommit={(next) => run(updateParameter({ id, changes: { name: next.trim() } }))}
          />
        </Field>
        <Field label="Unit">
          <UnitPicker
            label={`Unit of ${name}`}
            value={parameter.unit}
            onChange={(unit) => run(updateParameter({ id, changes: { unit } }))}
          />
        </Field>
      </div>

      <Field label="Expression">
        <ExpressionInput
          label={`Expression of ${name}`}
          value={parameter.expression}
          evaluate={(expression) =>
            evaluateDraft(doc, name, (d) => ({
              ...d,
              parameters: d.parameters.map((q) => (q.id === id ? { ...q, expression } : q)),
            }))
          }
          format={format}
          onCommit={(expression) => run(updateParameter({ id, changes: { expression } }))}
        />
      </Field>

      <Field label="Comment">
        <TextField
          label={`Comment on ${name}`}
          value={parameter.comment ?? ''}
          placeholder="What it is for"
          onCommit={(text) => run(updateParameter({ id, changes: { comment: text || undefined } }))}
        />
      </Field>

      <GroupPicker
        name={name}
        value={parameter.group}
        groups={groupNames(doc.parameters)}
        onPick={(group) => run(setParameterGroup({ id, ...(group ? { group } : {}) }))}
      />

      <UsedBy uses={uses} onSelect={onSelect} />

      <CustomizerCard parameter={parameter} evaluation={evaluation} format={format} run={run} />

      <div className="mt-auto flex items-center gap-1 border-t border-line pt-3">
        <IconButton
          label={`Move ${name} up`}
          shortcut="Alt+↑"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label={`Move ${name} down`}
          shortcut="Alt+↓"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={16} strokeWidth={1.75} />
        </IconButton>
        <span className="ml-1 text-sm text-muted">Order in this list and in the Customizer</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          aria-label={`Delete ${name}`}
          className="text-error hover:text-error"
          onClick={() => run(removeParameter({ id }))}
        >
          <Trash2 size={15} strokeWidth={1.75} aria-hidden />
          Delete parameter
        </Button>
      </div>
    </div>
  );
}

/**
 * The Customizer part (P4-07, ADR-0059 §1, ADR-0086 §2): a switch that shows
 * the parameter in the panel, and for a plain value the slider's range and
 * step, each an expression that may use other parameters.
 */
function CustomizerCard({
  parameter,
  evaluation,
  format,
  run,
}: {
  parameter: Parameter;
  evaluation: ParameterEvaluation;
  format(result: Extract<EvaluateResult, { ok: true }>): string;
  run: Run;
}) {
  const { id, name, customizer } = parameter;
  const exposed = customizer !== undefined;
  const plain = isPlainValue(parameter.expression);
  const range = customizer ?? {};
  const value = evaluation.parameters.get(name)?.result;
  const ends: Partial<Record<RangeField, number>> = {};
  for (const field of RANGE_FIELDS) {
    const text = range[field];
    if (text === undefined) continue;
    const result = evaluateRange(evaluation, parameter, field, text);
    if (result.ok) ends[field] = result.value;
  }
  const { min, max } = ends;
  const share =
    min !== undefined && max !== undefined && max > min && value?.ok
      ? Math.min(1, Math.max(0, (value.value - min) / (max - min)))
      : undefined;

  return (
    <section aria-label="Customizer" className="rounded-dialog border border-line px-4 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Customizer</h3>
          <p className="text-sm text-muted">
            A slider in the Customizer panel, under this parameter's group. A value outside the
            range is allowed; the panel warns about it.
          </p>
        </div>
        <Switch
          label={`Show ${name} in customizer`}
          checked={exposed}
          onChange={() => run(starCommand(id, exposed))}
        />
      </div>
      {exposed && !plain && (
        <p className="mt-3 text-sm text-muted">
          A formula has no slider: the panel shows its value read-only and follows the parameters it
          uses.
        </p>
      )}
      {exposed && plain && (
        <div className="mt-4">
          {share !== undefined && (
            <div aria-hidden className="relative mb-2 h-4">
              <div className="absolute inset-x-0 top-[7px] h-[3px] rounded-full bg-line" />
              <div
                className="absolute top-[7px] left-0 h-[3px] rounded-full bg-accent"
                style={{ width: `${share * 100}%` }}
              />
              <div
                className="absolute top-0.5 -ml-1.5 size-3 rounded-full border-2 border-accent bg-raised"
                style={{ left: `${share * 100}%` }}
              />
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {(['min', 'step', 'max'] as const).map((field) => (
              <Field key={field} label={RANGE_LABELS[field]}>
                <ExpressionInput
                  label={`${RANGE_LABELS[field]} of ${name}`}
                  placeholder="not set"
                  value={range[field] ?? ''}
                  evaluate={(text) =>
                    text.trim() === '' ? EMPTY : evaluateRange(evaluation, parameter, field, text)
                  }
                  format={format}
                  onCommit={(text) =>
                    run(
                      setParameterCustomizer({
                        id,
                        customizer: withRangeField(customizer, field, text),
                      }),
                    )
                  }
                />
              </Field>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** A model parameter (a feature input or sketch dimension with a name): its expression and users. */
export function ModelInspector({
  doc,
  evaluated,
  run,
  onSelect,
}: {
  doc: ExtrudoDocument;
  evaluated: EvaluatedParameter;
  run: Run;
  onSelect(selection: Selection): void;
}) {
  const { name, owner } = evaluated;
  const uses = useMemo(() => parameterUsers(doc, name), [doc, name]);
  if (owner.type === 'user') return null;
  const { featureId, input } = owner;
  const feature = featureName(doc, evaluated);
  const draft = (expression: string): ExtrudoDocument =>
    owner.type === 'dimension'
      ? withDimensionExpr(doc, featureId, input, owner.dimension, expression)
      : {
          ...doc,
          features: doc.features.map((f) =>
            f.id === featureId
              ? {
                  ...f,
                  inputs: {
                    ...f.inputs,
                    [input]: {
                      kind: 'expr' as const,
                      expr: expression,
                      paramName: name,
                      unit: evaluated.unit,
                    },
                  },
                }
              : f,
          ),
        };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
          Model parameter
        </span>
        <div className="font-mono text-md">{name}</div>
        <p className="text-sm text-muted">
          {owner.type === 'dimension' ? 'A dimension' : 'An input'} of {feature}. Expressions use it
          by this name.
        </p>
      </div>
      <Field label="Expression">
        <ExpressionInput
          label={`Expression of ${name}`}
          value={evaluated.expression}
          evaluate={(expression) => evaluateDraft(doc, name, () => draft(expression))}
          format={formatOf(doc)}
          onCommit={(expr) =>
            run(
              owner.type === 'dimension'
                ? updateSketchDimension({
                    feature: featureId,
                    id: owner.dimension,
                    changes: { expr },
                  })
                : updateFeatureInputs({
                    id: featureId,
                    inputs: {
                      [input]: { kind: 'expr', expr, paramName: name, unit: evaluated.unit },
                    },
                  }),
            )
          }
        />
      </Field>
      <UsedBy uses={uses} onSelect={onSelect} />
    </div>
  );
}

/**
 * A new user parameter: name, unit, expression and comment, added with Add (or
 * Enter). The new parameter is selected afterwards, so its group and slider
 * come next.
 */
export function NewParameterForm({
  doc,
  evaluation,
  run,
  onAdded,
}: {
  doc: ExtrudoDocument;
  evaluation: ParameterEvaluation;
  run: Run;
  onAdded(id: ParameterId): void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<UnitKind>('length');
  const [expression, setExpression] = useState('');
  const [comment, setComment] = useState('');
  const [valid, setValid] = useState(false);
  const ready = name.trim() !== '' && valid;

  const add = () => {
    if (!ready) return;
    const id = newId<ParameterId>();
    const added = run(
      addParameter({
        parameter: {
          id,
          name: name.trim(),
          expression,
          unit,
          ...(comment ? { comment } : {}),
        },
      }),
    );
    if (!added) return;
    onAdded(id);
    // The form goes away with the selection; focus goes to the new row, not the dialog.
    const row = name.trim();
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-parameter-row="${CSS.escape(row)}"]`)?.focus(),
    );
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
      // The expression field keeps Enter to itself (it commits), so Enter there adds here.
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.defaultPrevented) add();
      }}
    >
      <h3 className="text-md font-semibold">New parameter</h3>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <Field label="Name">
          <TextInput
            aria-label="New parameter name"
            placeholder="e.g. wall"
            className="h-9 font-mono text-md"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Unit">
          <UnitPicker label="New parameter unit" value={unit} onChange={setUnit} />
        </Field>
      </div>
      <Field label="Expression">
        <ExpressionInput
          label="New parameter expression"
          placeholder="e.g. 10 mm, or width - 2 * wall"
          value=""
          evaluate={(draft) => evaluation.evaluate(draft, unit)}
          format={formatOf(doc)}
          onDraftChange={(draft, ok) => {
            setExpression(draft);
            setValid(ok && draft.trim() !== '');
          }}
          onCommit={() => {}}
        />
      </Field>
      <Field label="Comment">
        <TextInput
          aria-label="New parameter comment"
          placeholder="What it is for"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={!ready}>
          Add
        </Button>
      </div>
    </form>
  );
}

/** A label over a field, in the dialog's small caps. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

/** Length, Angle or Number: three radio buttons drawn as one segmented control. */
function UnitPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: UnitKind;
  onChange(unit: UnitKind): void;
}) {
  const name = useId();
  return (
    <fieldset className="m-0 flex h-9 overflow-hidden rounded-control border border-line p-0">
      <legend className="sr-only">{label}</legend>
      {UNITS.map(([kind, text]) => (
        <label
          key={kind}
          className="flex cursor-pointer items-center border-l border-line px-3 text-base text-muted first-of-type:border-l-0 hover:text-ink has-checked:bg-accent-soft has-checked:font-semibold has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-accent has-focus-visible:-outline-offset-2"
        >
          <input
            type="radio"
            name={name}
            value={kind}
            checked={value === kind}
            onChange={() => onChange(kind)}
            className="sr-only"
          />
          {text}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The group, as chips (ADR-0086 §1): no group, each group in use, and a new
 * one typed in place. The first group sorts the list into sections.
 */
function GroupPicker({
  name,
  value,
  groups,
  onPick,
}: {
  name: string;
  value: string | undefined;
  groups: readonly string[];
  onPick(group: string | undefined): void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const chip =
    'inline-flex h-7 items-center gap-1 rounded-full border px-3 text-base transition-colors';
  const commit = () => {
    setAdding(false);
    if (draft.trim()) onPick(draft.trim());
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Group</span>
      <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
        <legend className="sr-only">Group of {name}</legend>
        {[undefined, ...groups].map((group) => (
          <button
            key={group ?? ''}
            type="button"
            aria-pressed={value === group}
            onClick={() => value !== group && onPick(group)}
            className={`${chip} border-line text-muted hover:border-accent hover:text-ink aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:font-semibold aria-pressed:text-ink`}
          >
            {group ?? 'No group'}
          </button>
        ))}
        {adding ? (
          <TextInput
            autoFocus
            aria-label="New group name"
            placeholder="Group name"
            maxLength={40}
            className="h-7 w-44 rounded-full px-3"
            value={draft}
            data-keep-escape
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={`${chip} border-dashed border-line text-muted hover:border-accent hover:text-ink`}
          >
            <Plus size={12} aria-hidden />
            New group
          </button>
        )}
      </fieldset>
      {groups.length === 0 && (
        <p className="text-sm text-muted">
          No groups yet, so the list is one flat list. The first group sorts it into sections.
        </p>
      )}
    </div>
  );
}

/**
 * What uses the parameter (ADR-0086 §4): parameters, slider ranges, features,
 * sketch dimensions, joint limits. A parameter's chip selects it.
 */
function UsedBy({
  uses,
  onSelect,
}: {
  uses: readonly ParameterUse[];
  onSelect(selection: Selection): void;
}) {
  const chip =
    'inline-flex h-6 items-center rounded-full bg-accent-soft/50 px-2.5 font-mono text-field text-muted';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm text-muted">Used by</span>
      {uses.length === 0 && <span className="text-sm text-muted">nothing yet</span>}
      {uses.map((use) => {
        const label = labelOfUse(use);
        const target: Selection | undefined =
          use.kind === 'parameter' || use.kind === 'range'
            ? { kind: 'user', id: use.id }
            : use.kind === 'feature' && use.paramName !== undefined
              ? { kind: 'model', name: use.paramName }
              : undefined;
        return target ? (
          <button
            key={label}
            type="button"
            onClick={() => onSelect(target)}
            className={`${chip} hover:bg-accent-soft hover:text-ink`}
          >
            {label}
          </button>
        ) : (
          <span key={label} className={chip}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

/** An on/off switch, for a setting that applies at once. */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-(--x-fast) ${checked ? 'bg-accent' : 'bg-muted/45'}`}
    >
      <span
        aria-hidden
        className={`absolute top-[3px] size-4 rounded-full shadow transition-[left] duration-(--x-fast) ${checked ? 'left-[19px]' : 'left-[3px]'}`}
        style={{ background: '#fff' }}
      />
    </button>
  );
}

/**
 * Evaluates a parameter as if its expression were already changed, so the
 * field sees cycles and the effect on units before anything is committed.
 */
function evaluateDraft(
  doc: ExtrudoDocument,
  name: string,
  change: (doc: ExtrudoDocument) => ExtrudoDocument,
): EvaluateResult {
  const result = evaluateParameters(change(doc)).parameters.get(name)?.result;
  return result ?? { ok: true, value: 0, dim: { length: 0, angle: 0 } };
}

/** A text field that commits on Enter or blur and reverts on Esc. */
function TextField({
  label,
  value,
  placeholder,
  className,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  className?: string;
  onCommit(value: string): boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value && !onCommit(draft)) setDraft(value);
  };
  return (
    <TextInput
      aria-label={label}
      className={className}
      placeholder={placeholder}
      value={draft}
      data-keep-escape={draft !== value || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape' && draft !== value) setDraft(value);
      }}
    />
  );
}
