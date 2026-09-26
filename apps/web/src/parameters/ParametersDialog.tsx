import {
  addParameter,
  type Command,
  CommandError,
  type DocumentStore,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureId,
  formatQuantity,
  newId,
  type ParameterId,
  removeParameter,
  type UnitKind,
  updateFeatureInputs,
  updateParameter,
  updateSketchDimension,
} from '@extrudo/core';
import { Redo2, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { shortcutLabel } from '../commands/shortcuts';
import { Button, Dialog, DialogClose, IconButton, Select, TextInput } from '../design-system';
import { withDimensionExpr } from './drafts';
import { ExpressionInput } from './ExpressionInput';
import { Message } from './Message';

const UNIT_LABELS: Record<UnitKind, string> = {
  length: 'Length',
  angle: 'Angle',
  unitless: 'Number',
};

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
 */
export function ParametersDialog({ store, apply, open, onOpenChange }: ParametersDialogProps) {
  const doc = useStore(store, (s) => s.doc);
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useStore(store);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const [message, setMessage] = useState('');

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
              const comment = doc.parameters.find((q) => q.id === id)?.comment ?? '';
              return (
                <tr key={id}>
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
                  <td className={td}>
                    <IconButton
                      label={`Delete ${p.name}`}
                      onClick={() => run(removeParameter({ id }))}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </IconButton>
                  </td>
                </tr>
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
  className,
  onCommit,
}: {
  label: string;
  value: string;
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
