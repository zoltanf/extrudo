import {
  addParameter,
  type Command,
  CommandError,
  type Customizer,
  type DocumentStore,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureId,
  formatQuantity,
  newId,
  type ParameterId,
  removeParameter,
  setParameterCustomizer,
  type UnitKind,
  updateFeatureInputs,
  updateParameter,
  updateSketchDimension,
} from '@extrudo/core';
import { Eraser, Redo2, Star, Trash2, Undo2, X } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { isEditable, shortcutLabel } from '../commands/shortcuts';
import {
  Button,
  ContextMenu,
  Dialog,
  DialogClose,
  IconButton,
  MenuItem,
  MenuSeparator,
  Select,
  TextInput,
} from '../design-system';
import {
  CUSTOMIZER_FIELDS,
  type CustomizerField,
  rangeText,
  withoutRangeField,
  withRangeField,
} from './customizer';
import { withDimensionExpr } from './drafts';
import { ExpressionInput } from './ExpressionInput';
import { Message } from './Message';

const UNIT_LABELS: Record<UnitKind, string> = {
  length: 'Length',
  angle: 'Angle',
  unitless: 'Number',
};

/**
 * What a row's star writes (P4-07, ADR-0059 §1): an empty `customizer` object
 * exposes the parameter, taking the star off leaves it out again (one command,
 * one undo step). Exposed and unexposed are different settings, so starring a
 * parameter that was in the panel before starts its range afresh.
 */
export function starCommand(id: ParameterId, starred: boolean): Command<unknown> {
  return setParameterCustomizer({ id, customizer: starred ? undefined : {} });
}

export interface ParametersDialogProps {
  store: DocumentStore;
  /**
   * Runs a command; by default the store's `dispatch`. The shell passes one
   * that also re-solves the sketches whose dimensions change (P1-07).
   */
  apply?(command: Command<unknown>): void;
  open: boolean;
  onOpenChange(open: boolean): void;
}

const th = 'px-1.5 pb-1 text-left text-sm font-medium text-muted';
const td = 'px-1.5 py-1 align-top';

/**
 * The Parameters dialog (P0-07, FR-PAR-01): user parameters (add, edit,
 * delete, comment) and the model parameters of features, each with its live
 * value and inline errors. Every change is one command, so undoable.
 *
 * A user parameter can be starred for the Customizer panel (P4-07, ADR-0059 §1):
 * the star is one command, and the row then shows the slider's range, its step
 * and the heading the row gets there. The range is in the parameter's base unit;
 * the fields speak its unit.
 */
export function ParametersDialog({ store, apply, open, onOpenChange }: ParametersDialogProps) {
  const doc = useStore(store, (s) => s.doc);
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useStore(store);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const [message, setMessage] = useState('');
  // A right-click in a text field of a row keeps the browser's own menu (copy, paste).
  const [nativeRow, setNativeRow] = useState<string>();

  /** Dispatches a command; a rejected one shows its message instead of throwing. */
  const run = (command: Command<unknown>): boolean => {
    try {
      if (apply) apply(command);
      else store.getState().dispatch(command);
      setMessage('');
      return true;
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      setMessage(error.message);
      return false;
    }
  };

  const all = [...evaluation.parameters.values()];
  const user = all.flatMap((p) => (p.owner.type === 'user' ? [{ p, id: p.owner.id }] : []));
  // Feature inputs and sketch dimensions (P1-07), in timeline order.
  const model = all.flatMap((p) => (p.owner.type !== 'user' ? [{ p, owner: p.owner }] : []));
  const featureName = (id: FeatureId) => doc.features.find((f) => f.id === id)?.name ?? '';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setMessage('');
        onOpenChange(next);
      }}
      title="Parameters"
      description="Named values that drive the model. Every change can be undone."
      actions={
        <>
          <IconButton
            label="Undo"
            shortcut={shortcutLabel('Mod+Z')}
            hint={undoLabel ? `Undo “${undoLabel}”.` : 'Nothing to undo.'}
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 size={18} strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label="Redo"
            shortcut={shortcutLabel('Mod+Y')}
            hint={redoLabel ? `Redo “${redoLabel}”.` : 'Nothing to redo.'}
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 size={18} strokeWidth={1.75} />
          </IconButton>
          <DialogClose asChild>
            <IconButton label="Close">
              <X size={18} strokeWidth={1.75} />
            </IconButton>
          </DialogClose>
        </>
      }
    >
      <p className="mb-2 min-h-5 text-sm text-error" role="alert">
        <Message text={message} />
      </p>

      <div className="overflow-x-auto">
        <table className="mb-5 w-full min-w-[640px] table-fixed border-collapse">
          <caption className="pb-1.5 text-left font-semibold">User parameters</caption>
          <thead>
            <tr>
              <th scope="col" className={`${th} w-36`}>
                Name
              </th>
              <th scope="col" className={`${th} w-32`}>
                Unit
              </th>
              <th scope="col" className={th}>
                Expression and value
              </th>
              <th scope="col" className={`${th} w-[28%]`}>
                Comment
              </th>
              <th scope="col" className={`${th} w-16`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {user.map(({ p, id }) => {
              const parameter = doc.parameters.find((q) => q.id === id);
              const comment = parameter?.comment ?? '';
              const customizer = parameter?.customizer;
              const row = (
                <tr
                  key={id}
                  onPointerDownCapture={(e) => setNativeRow(isEditable(e.target) ? id : undefined)}
                >
                  <td className={td}>
                    <TextField
                      label={`Name of ${p.name}`}
                      value={p.name}
                      className="font-mono text-field"
                      onCommit={(name) => run(updateParameter({ id, changes: { name } }))}
                    />
                  </td>
                  <td className={td}>
                    <Select
                      aria-label={`Unit of ${p.name}`}
                      value={p.unit}
                      onChange={(e) =>
                        run(updateParameter({ id, changes: { unit: e.target.value as UnitKind } }))
                      }
                    >
                      {Object.entries(UNIT_LABELS).map(([kind, text]) => (
                        <option key={kind} value={kind}>
                          {text}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className={td}>
                    <ExpressionInput
                      label={`Expression of ${p.name}`}
                      value={p.expression}
                      evaluate={(expression) =>
                        evaluateDraft(doc, p.name, (d) => ({
                          ...d,
                          parameters: d.parameters.map((q) =>
                            q.id === id ? { ...q, expression } : q,
                          ),
                        }))
                      }
                      format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
                      onCommit={(expression) =>
                        run(updateParameter({ id, changes: { expression } }))
                      }
                    />
                  </td>
                  <td className={td}>
                    <TextField
                      label={`Comment on ${p.name}`}
                      value={comment}
                      onCommit={(text) =>
                        run(updateParameter({ id, changes: { comment: text || undefined } }))
                      }
                    />
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <IconButton
                      label={`Show ${p.name} in customizer`}
                      hint={
                        customizer
                          ? 'In the Customizer panel. The star takes it out again.'
                          : 'Show this parameter in the Customizer panel.'
                      }
                      pressed={customizer !== undefined}
                      onClick={() => run(starCommand(id, customizer !== undefined))}
                    >
                      <Star
                        size={16}
                        strokeWidth={1.75}
                        className={customizer ? 'fill-current text-warning' : undefined}
                      />
                    </IconButton>
                    <IconButton
                      label={`Delete ${p.name}`}
                      onClick={() => run(removeParameter({ id }))}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </IconButton>
                  </td>
                </tr>
              );
              return (
                <Fragment key={id}>
                  <ContextMenu label={`${p.name} menu`} disabled={nativeRow === id} trigger={row}>
                    <MenuItem
                      icon={<Star size={14} />}
                      onSelect={() => run(starCommand(id, customizer !== undefined))}
                    >
                      {customizer
                        ? `Hide ${p.name} from customizer`
                        : `Show ${p.name} in customizer`}
                    </MenuItem>
                    <MenuItem
                      icon={<Trash2 size={14} />}
                      onSelect={() => run(removeParameter({ id }))}
                    >
                      Delete {p.name}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Undo2 size={14} />} disabled={!canUndo} onSelect={undo}>
                      {undoLabel ? `Undo ${undoLabel}` : 'Undo'}
                    </MenuItem>
                    <MenuItem icon={<Redo2 size={14} />} disabled={!canRedo} onSelect={redo}>
                      {redoLabel ? `Redo ${redoLabel}` : 'Redo'}
                    </MenuItem>
                  </ContextMenu>
                  {customizer && (
                    <CustomizerFields
                      name={p.name}
                      unit={p.unit}
                      customizer={customizer}
                      settings={doc.settings}
                      evaluate={(text) => evaluation.evaluate(text, p.unit)}
                      format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
                      onChange={(next) => run(setParameterCustomizer({ id, customizer: next }))}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <AddParameterRow doc={doc} onAdd={run} />
          </tfoot>
        </table>

        {model.length > 0 && (
          <table className="w-full min-w-[640px] table-fixed border-collapse">
            <caption className="pb-1.5 text-left font-semibold">Model parameters</caption>
            <thead>
              <tr>
                <th scope="col" className={`${th} w-36`}>
                  Name
                </th>
                <th scope="col" className={`${th} w-32`}>
                  Feature
                </th>
                <th scope="col" className={th}>
                  Expression and value
                </th>
              </tr>
            </thead>
            <tbody>
              {model.map(({ p, owner }) => {
                const { featureId, input } = owner;
                const draft = (expression: string) =>
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
                                    paramName: p.name,
                                    unit: p.unit,
                                  },
                                },
                              }
                            : f,
                        ),
                      };
                return (
                  <tr key={p.name}>
                    <td className={`${td} pt-2.5 font-mono text-field`}>{p.name}</td>
                    <td className={`${td} pt-2.5`}>{featureName(featureId)}</td>
                    <td className={td}>
                      <ExpressionInput
                        label={`Expression of ${p.name}`}
                        value={p.expression}
                        evaluate={(expression) =>
                          evaluateDraft(doc, p.name, () => draft(expression))
                        }
                        format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
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
                                    [input]: {
                                      kind: 'expr',
                                      expr,
                                      paramName: p.name,
                                      unit: p.unit,
                                    },
                                  },
                                }),
                          )
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}

const RANGE_LABELS: Record<CustomizerField, string> = { min: 'Min', max: 'Max', step: 'Step' };

/**
 * The customizer settings of a starred parameter, under its row (P4-07,
 * ADR-0059 §1): the slider's range and step (expressions in the parameter's
 * unit, stored in its base unit) and the panel heading the row sits under. A
 * range that runs backwards is refused by the command, and the dialog's message
 * line says so.
 */
function CustomizerFields({
  name,
  unit,
  customizer,
  settings,
  evaluate,
  format,
  onChange,
}: {
  name: string;
  unit: UnitKind;
  customizer: Customizer;
  settings: ExtrudoDocument['settings'];
  evaluate(expression: string): EvaluateResult;
  format(result: Extract<EvaluateResult, { ok: true }>): string;
  onChange(customizer: Customizer): void;
}) {
  return (
    <tr data-customizer-fields={name}>
      <td colSpan={5} className="pb-3">
        <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-control bg-raised p-2">
          <span className="text-sm font-semibold">Customizer</span>
          <p className="text-sm text-muted">
            The slider this parameter gets in the Customizer panel. A value outside the range is
            allowed; the panel warns about it.
          </p>
          {CUSTOMIZER_FIELDS.map((field) => (
            <Fragment key={field}>
              <span className="text-sm text-muted">{RANGE_LABELS[field]}</span>
              <div className="flex min-w-0 items-start gap-1">
                <ExpressionInput
                  className="min-w-0 flex-1"
                  label={`${RANGE_LABELS[field]} of ${name}`}
                  placeholder="not set"
                  value={rangeText(unit, customizer[field], settings)}
                  evaluate={evaluate}
                  format={format}
                  onCommit={(text) => onChange(withRangeField(customizer, field, text, evaluate))}
                />
                {customizer[field] !== undefined && (
                  <IconButton
                    label={`Clear ${RANGE_LABELS[field]} of ${name}`}
                    hint={`Take the ${RANGE_LABELS[field].toLowerCase()} away.`}
                    onClick={() => onChange(withoutRangeField(customizer, field))}
                  >
                    <Eraser size={14} strokeWidth={1.75} />
                  </IconButton>
                )}
              </div>
            </Fragment>
          ))}
          <span className="text-sm text-muted">Group</span>
          <TextField
            label={`Group of ${name}`}
            value={customizer.group ?? ''}
            placeholder="no group"
            onCommit={(text) => {
              onChange({ ...customizer, group: text.trim() || undefined });
              return true;
            }}
          />
        </div>
      </td>
    </tr>
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

function AddParameterRow({
  doc,
  onAdd,
}: {
  doc: ExtrudoDocument;
  onAdd(command: Command<unknown>): boolean;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<UnitKind>('length');
  const [expression, setExpression] = useState('');
  const [comment, setComment] = useState('');
  const [valid, setValid] = useState(false);
  // Remounts the expression field after an add, which clears it.
  const [resets, setResets] = useState(0);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);

  const add = () => {
    const added = onAdd(
      addParameter({
        parameter: {
          id: newId<ParameterId>(),
          name: name.trim(),
          expression,
          unit,
          ...(comment ? { comment } : {}),
        },
      }),
    );
    if (added) {
      setName('');
      setExpression('');
      setComment('');
      setValid(false);
      setResets((n) => n + 1);
    }
  };

  return (
    <tr>
      <td className={td}>
        <TextInput
          aria-label="New parameter name"
          placeholder="name"
          className="font-mono text-field"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </td>
      <td className={td}>
        <Select
          aria-label="New parameter unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value as UnitKind)}
        >
          {Object.entries(UNIT_LABELS).map(([kind, text]) => (
            <option key={kind} value={kind}>
              {text}
            </option>
          ))}
        </Select>
      </td>
      <td className={td}>
        <ExpressionInput
          label="New parameter expression"
          placeholder="e.g. 10 mm"
          value=""
          evaluate={(draft) => evaluation.evaluate(draft, unit)}
          format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
          onDraftChange={(draft, valid) => {
            setExpression(draft);
            setValid(valid);
          }}
          onCommit={() => {}}
          key={resets}
        />
      </td>
      <td className={td}>
        <TextInput
          aria-label="New parameter comment"
          placeholder="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </td>
      <td className={td}>
        <Button variant="primary" disabled={!name.trim() || !valid} onClick={add}>
          Add
        </Button>
      </td>
    </tr>
  );
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
