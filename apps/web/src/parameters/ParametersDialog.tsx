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
} from '@extrudo/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ExpressionInput } from './ExpressionInput';
import { Message } from './Message';

const UNIT_LABELS: Record<UnitKind, string> = {
  length: 'Length',
  angle: 'Angle',
  unitless: 'Number',
};

export interface ParametersDialogProps {
  store: DocumentStore;
  open: boolean;
  onClose(): void;
}

/**
 * The Parameters dialog (P0-07, FR-PAR-01): user parameters (add, edit,
 * delete, comment) and the model parameters of features, each with its live
 * value and inline errors. Every change is one command, so undoable.
 *
 * Uses a native `<dialog>`; P0-04 moves it onto the design system's dialog.
 */
export function ParametersDialog({ store, open, onClose }: ParametersDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const doc = useStore(store, (s) => s.doc);
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useStore(store);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  /** Dispatches a command; a rejected one shows its message instead of throwing. */
  const run = (command: Command<unknown>): boolean => {
    try {
      store.getState().dispatch(command);
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
  const model = all.flatMap((p) => (p.owner.type === 'model' ? [{ p, ...p.owner }] : []));
  const featureName = (id: FeatureId) => doc.features.find((f) => f.id === id)?.name ?? '';

  return (
    <dialog
      ref={dialog}
      className="parameters-dialog"
      aria-labelledby="parameters-title"
      onClose={onClose}
    >
      <header>
        <h2 id="parameters-title">Parameters</h2>
        <div className="actions">
          <button
            type="button"
            disabled={!canUndo}
            onClick={undo}
            title={undoLabel && `Undo ${undoLabel}`}
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={redo}
            title={redoLabel && `Redo ${redoLabel}`}
          >
            Redo
          </button>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      </header>

      <p className="command-message" role="alert">
        <Message text={message} />
      </p>

      <table>
        <caption>User parameters</caption>
        <thead>
          <tr>
            <th scope="col" className="col-name">
              Name
            </th>
            <th scope="col" className="col-unit">
              Unit
            </th>
            <th scope="col">Expression and value</th>
            <th scope="col" className="col-comment">
              Comment
            </th>
            <th scope="col" className="col-actions">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {user.map(({ p, id }) => {
            const comment = doc.parameters.find((q) => q.id === id)?.comment ?? '';
            return (
              <tr key={id}>
                <td>
                  <TextField
                    label={`Name of ${p.name}`}
                    value={p.name}
                    className="name"
                    onCommit={(name) => run(updateParameter({ id, changes: { name } }))}
                  />
                </td>
                <td>
                  <select
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
                  </select>
                </td>
                <td>
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
                    onCommit={(expression) => run(updateParameter({ id, changes: { expression } }))}
                  />
                </td>
                <td>
                  <TextField
                    label={`Comment on ${p.name}`}
                    value={comment}
                    onCommit={(text) =>
                      run(updateParameter({ id, changes: { comment: text || undefined } }))
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="delete"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => run(removeParameter({ id }))}
                  >
                    ✕
                  </button>
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
        <table>
          <caption>Model parameters</caption>
          <thead>
            <tr>
              <th scope="col" className="col-name">
                Name
              </th>
              <th scope="col" className="col-unit">
                Feature
              </th>
              <th scope="col">Expression and value</th>
            </tr>
          </thead>
          <tbody>
            {model.map(({ p, featureId, input }) => {
              return (
                <tr key={p.name}>
                  <td className="name">{p.name}</td>
                  <td>{featureName(featureId)}</td>
                  <td>
                    <ExpressionInput
                      label={`Expression of ${p.name}`}
                      value={p.expression}
                      evaluate={(expression) =>
                        evaluateDraft(doc, p.name, (d) => ({
                          ...d,
                          features: d.features.map((f) =>
                            f.id === featureId
                              ? {
                                  ...f,
                                  inputs: {
                                    ...f.inputs,
                                    [input]: {
                                      kind: 'expr',
                                      expr: expression,
                                      paramName: p.name,
                                      unit: p.unit,
                                    },
                                  },
                                }
                              : f,
                          ),
                        }))
                      }
                      format={(r) => formatQuantity(r.value, r.dim, doc.settings)}
                      onCommit={(expr) =>
                        run(
                          updateFeatureInputs({
                            id: featureId,
                            inputs: {
                              [input]: { kind: 'expr', expr, paramName: p.name, unit: p.unit },
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
    </dialog>
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
    <tr className="add-row">
      <td>
        <input
          type="text"
          aria-label="New parameter name"
          placeholder="name"
          className="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </td>
      <td>
        <select
          aria-label="New parameter unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value as UnitKind)}
        >
          {Object.entries(UNIT_LABELS).map(([kind, text]) => (
            <option key={kind} value={kind}>
              {text}
            </option>
          ))}
        </select>
      </td>
      <td>
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
      <td>
        <input
          type="text"
          aria-label="New parameter comment"
          placeholder="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </td>
      <td>
        <button type="button" disabled={!name.trim() || !valid} onClick={add}>
          Add
        </button>
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
    <input
      type="text"
      aria-label={label}
      className={className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape' && draft !== value) {
          e.preventDefault();
          setDraft(value);
        }
      }}
    />
  );
}
