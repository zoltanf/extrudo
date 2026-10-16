import {
  type Command,
  CommandError,
  type DocumentStore,
  type EvaluatedParameter,
  type ExtrudoDocument,
  evaluateParameters,
  formatQuantity,
  isPlainValue,
  moveParameter,
  type ParameterEvaluation,
  type ParameterId,
  removeParameter,
} from '@extrudo/core';
import { ChevronRight, GripVertical, Plus, Redo2, Star, Trash2, Undo2, X } from 'lucide-react';
import { type DragEvent, type ReactElement, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { shortcutLabel } from '../commands/shortcuts';
import {
  ContextMenu,
  Dialog,
  DialogClose,
  IconButton,
  MenuItem,
  MenuSeparator,
} from '../design-system';
import { dropIndex, featureName, listSections, starCommand, stepIndex } from './list';
import { Message } from './Message';
import {
  ModelInspector,
  NewParameterForm,
  type Selection,
  UserInspector,
} from './ParameterInspector';

export { starCommand } from './list';

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

/** The drag data type of a parameter row, so other drags (files) are left alone. */
const DRAG_TYPE = 'application/x-extrudo-parameter';

/** Where a dragged row would land: before a row, or at the end of a section. */
interface DropTarget {
  before?: ParameterId;
  group: string | undefined;
}

/**
 * The Parameters dialog (P0-07, FR-PAR-01, ADR-0086): a list of the
 * parameters on the left and the selected one's settings on the right.
 *
 * The list holds the user parameters, in sections by group once any parameter
 * has one ("General" first for the rest), and below them the model parameters
 * of features and sketch dimensions. A row is dragged to reorder or into
 * another group, or moved with Alt+↑ and Alt+↓; the order is the customizer
 * panel's order too. Every change is one command, so undoable.
 */
export function ParametersDialog({ store, apply, open, onOpenChange }: ParametersDialogProps) {
  const doc = useStore(store, (s) => s.doc);
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useStore(store);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState<Selection>();

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

  const model = [...evaluation.parameters.values()].filter((p) => p.owner.type !== 'user');
  const selection = resolveSelection(chosen, doc, model);
  const select = (next: Selection) => {
    setChosen(next);
    setMessage('');
  };
  /** Moves a user parameter past its neighbour in its group (Move up, Move down, Alt+arrows). */
  const step = (id: ParameterId, direction: -1 | 1) => {
    const index = stepIndex(doc.parameters, id, direction);
    if (index !== undefined) run(moveParameter({ id, index }));
  };
  const history = { canUndo, canRedo, undoLabel, redoLabel, undo, redo };

  let inspector: ReactElement | null;
  if (selection.kind === 'user') {
    const parameter = doc.parameters.find((p) => p.id === selection.id);
    inspector = parameter ? (
      <UserInspector
        key={parameter.id}
        doc={doc}
        evaluation={evaluation}
        parameter={parameter}
        run={run}
        onSelect={select}
        canMoveUp={stepIndex(doc.parameters, parameter.id, -1) !== undefined}
        canMoveDown={stepIndex(doc.parameters, parameter.id, 1) !== undefined}
        onMove={(direction) => step(parameter.id, direction)}
      />
    ) : null;
  } else if (selection.kind === 'model') {
    const evaluated = evaluation.parameters.get(selection.name);
    inspector = evaluated ? (
      <ModelInspector
        key={evaluated.name}
        doc={doc}
        evaluated={evaluated}
        run={run}
        onSelect={select}
      />
    ) : null;
  } else {
    inspector = (
      <NewParameterForm
        doc={doc}
        evaluation={evaluation}
        run={run}
        onAdded={(id) => select({ kind: 'user', id })}
      />
    );
  }

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
      <div className="-mx-6 -my-4 grid h-[min(660px,calc(100vh-150px))] grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
        <ParameterList
          doc={doc}
          evaluation={evaluation}
          model={model}
          selection={selection}
          run={run}
          onSelect={select}
          onStep={step}
          history={history}
        />
        <div className="flex min-h-0 flex-col overflow-y-auto px-6 py-4">
          <p className={message ? 'mb-3 text-sm text-error' : ''} role="alert">
            <Message text={message} />
          </p>
          {inspector}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The selection the dialog shows: the chosen parameter while it exists (an
 * undo can take it away), else the first row of the list, else the New
 * parameter form.
 */
function resolveSelection(
  chosen: Selection | undefined,
  doc: ExtrudoDocument,
  model: readonly EvaluatedParameter[],
): Selection {
  if (chosen?.kind === 'new') return chosen;
  if (chosen?.kind === 'user' && doc.parameters.some((p) => p.id === chosen.id)) return chosen;
  if (chosen?.kind === 'model' && model.some((p) => p.name === chosen.name)) return chosen;
  const first = listSections(doc.parameters)[0]?.ids[0];
  return first ? { kind: 'user', id: first } : { kind: 'new' };
}

interface History {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
  undo(): void;
  redo(): void;
}

/** The list on the left: user parameters by section, New parameter, model parameters. */
function ParameterList({
  doc,
  evaluation,
  model,
  selection,
  run,
  onSelect,
  onStep,
  history,
}: {
  doc: ExtrudoDocument;
  evaluation: ParameterEvaluation;
  model: readonly EvaluatedParameter[];
  selection: Selection;
  run(command: Command<unknown>): boolean;
  onSelect(selection: Selection): void;
  onStep(id: ParameterId, direction: -1 | 1): void;
  history: History;
}) {
  const [dragging, setDragging] = useState<ParameterId>();
  const [drop, setDrop] = useState<DropTarget>();
  const [modelOpen, setModelOpen] = useState(false);
  const showModel = modelOpen || selection.kind === 'model';
  const sections = listSections(doc.parameters, dragging !== undefined);
  const grouped = sections.length > 1 || sections[0]?.title !== 'User parameters';
  const settings = doc.settings;

  const endDrag = () => {
    setDragging(undefined);
    setDrop(undefined);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const id = dragging;
    const target = drop;
    endDrag();
    if (id === undefined || target === undefined) return;
    const parameter = doc.parameters.find((p) => p.id === id);
    if (!parameter) return;
    const index = dropIndex(doc.parameters, id, target);
    const regroup = grouped && target.group !== parameter.group;
    if (!regroup && index === doc.parameters.indexOf(parameter)) return;
    run(moveParameter({ id, index, ...(regroup ? { group: target.group ?? null } : {}) }));
  };
  /** The drop target under the pointer on a row: its top half is before it, the bottom half after. */
  const overRow = (
    event: DragEvent,
    ids: readonly ParameterId[],
    index: number,
    group?: string,
  ) => {
    if (dragging === undefined) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    const before = after ? ids[index + 1] : ids[index];
    setDrop(before === undefined ? { group } : { before, group });
  };

  return (
    <div className="flex min-h-0 flex-col border-r border-line bg-panel">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {sections.map((section) => {
          const atEnd =
            drop !== undefined && drop.before === undefined && drop.group === section.group;
          return (
            <section
              key={section.title}
              aria-label={section.title}
              data-parameter-section={section.title}
              className="mb-2"
              onDragOver={(event) => {
                if (dragging === undefined || section.ids.length > 0) return;
                event.preventDefault();
                setDrop({ group: section.group });
              }}
              onDrop={onDrop}
            >
              <h3 className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                {grouped && <ChevronRight size={12} className="rotate-90" aria-hidden />}
                {section.title}
                <span className="font-normal tracking-normal">{section.ids.length}</span>
              </h3>
              {section.ids.length === 0 && (
                <div
                  className={`mx-1 rounded-control border border-dashed px-2 py-1.5 text-sm text-muted ${atEnd ? 'border-accent' : 'border-line'}`}
                >
                  Drop here for no group
                </div>
              )}
              <ul>
                {section.ids.map((id, index) => {
                  const parameter = doc.parameters.find((p) => p.id === id);
                  if (!parameter) return null;
                  const evaluated = evaluation.parameters.get(parameter.name);
                  const exposed = parameter.customizer !== undefined;
                  const line =
                    drop?.before === id
                      ? 'top'
                      : atEnd && index === section.ids.length - 1
                        ? 'bottom'
                        : undefined;
                  const selected = selection.kind === 'user' && selection.id === id;
                  // The drag starts on the row, not the button: Firefox doesn't drag a button.
                  const row = (
                    <li
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(DRAG_TYPE, id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDragging(id);
                      }}
                      onDragEnd={endDrag}
                      onDragOver={(event) => overRow(event, section.ids, index, section.group)}
                      onDrop={onDrop}
                      className={`group relative grid h-8 grid-cols-[16px_minmax(0,1fr)] items-center rounded-control pl-1 ${dragging === id ? 'opacity-40' : ''} ${selected ? 'bg-accent-soft' : 'hover:bg-line/50'}`}
                    >
                      {line && (
                        <span
                          aria-hidden
                          className={`absolute inset-x-1 h-0.5 rounded-full bg-accent ${line === 'top' ? '-top-px' : '-bottom-px'}`}
                        />
                      )}
                      <GripVertical
                        size={12}
                        aria-hidden
                        className="cursor-grab text-muted opacity-40 group-hover:opacity-100"
                      />
                      <button
                        type="button"
                        data-parameter-row={parameter.name}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => onSelect({ kind: 'user', id })}
                        onKeyDown={(event) => {
                          if (
                            !event.altKey ||
                            (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
                          )
                            return;
                          event.preventDefault();
                          onStep(id, event.key === 'ArrowUp' ? -1 : 1);
                        }}
                        className="group grid h-8 w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 pr-2.5 text-left font-mono text-field text-ink"
                      >
                        <Star
                          size={13}
                          strokeWidth={1.75}
                          aria-hidden
                          className={exposed ? 'fill-current text-accent' : 'text-muted opacity-40'}
                        />
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{parameter.name}</span>
                          {!isPlainValue(parameter.expression) && <FormulaMark />}
                          {exposed && <span className="sr-only">(in the customizer)</span>}
                        </span>
                        <ValueText evaluated={evaluated} settings={settings} />
                      </button>
                    </li>
                  );
                  return (
                    <ContextMenu key={id} label={`${parameter.name} menu`} trigger={row}>
                      <MenuItem
                        icon={<Star size={14} />}
                        onSelect={() => run(starCommand(id, exposed))}
                      >
                        {exposed
                          ? `Hide ${parameter.name} from customizer`
                          : `Show ${parameter.name} in customizer`}
                      </MenuItem>
                      <MenuItem
                        disabled={stepIndex(doc.parameters, id, -1) === undefined}
                        onSelect={() => onStep(id, -1)}
                      >
                        Move up
                      </MenuItem>
                      <MenuItem
                        disabled={stepIndex(doc.parameters, id, 1) === undefined}
                        onSelect={() => onStep(id, 1)}
                      >
                        Move down
                      </MenuItem>
                      <MenuItem
                        icon={<Trash2 size={14} />}
                        onSelect={() => run(removeParameter({ id }))}
                      >
                        Delete {parameter.name}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        icon={<Undo2 size={14} />}
                        disabled={!history.canUndo}
                        onSelect={history.undo}
                      >
                        {history.undoLabel ? `Undo ${history.undoLabel}` : 'Undo'}
                      </MenuItem>
                      <MenuItem
                        icon={<Redo2 size={14} />}
                        disabled={!history.canRedo}
                        onSelect={history.redo}
                      >
                        {history.redoLabel ? `Redo ${history.redoLabel}` : 'Redo'}
                      </MenuItem>
                    </ContextMenu>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <button
          type="button"
          aria-current={selection.kind === 'new' ? 'true' : undefined}
          onClick={() => onSelect({ kind: 'new' })}
          className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-base text-muted hover:bg-line/50 hover:text-ink aria-[current]:bg-accent-soft aria-[current]:hover:bg-accent-soft aria-[current]:text-ink"
        >
          <Plus size={14} aria-hidden />
          New parameter
        </button>
        {doc.parameters.length > 1 && (
          <p className="px-2 pt-1 text-sm text-muted">
            Drag to reorder, or into another group. The order is the Customizer's order too.
          </p>
        )}

        {model.length > 0 && (
          <section aria-label="Model parameters" className="mt-3 border-t border-line pt-2">
            <button
              type="button"
              aria-expanded={showModel}
              onClick={() => setModelOpen(!showModel)}
              className="flex h-8 w-full items-center justify-between rounded-control px-2 text-base text-muted hover:bg-line/50 hover:text-ink"
            >
              <span className="flex items-center gap-1.5">
                <ChevronRight
                  size={14}
                  aria-hidden
                  className={showModel ? 'rotate-90 transition-transform' : 'transition-transform'}
                />
                Model parameters
              </span>
              <span>{model.length}</span>
            </button>
            {showModel && (
              <ul>
                {model.map((p) => (
                  <li key={p.name}>
                    <button
                      type="button"
                      data-parameter-row={p.name}
                      aria-current={
                        selection.kind === 'model' && selection.name === p.name ? 'true' : undefined
                      }
                      onClick={() => onSelect({ kind: 'model', name: p.name })}
                      className="group grid h-8 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-control pr-2.5 pl-7 text-left hover:bg-line/50 aria-[current]:bg-accent-soft aria-[current]:hover:bg-accent-soft"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-field">{p.name}</span>
                        {!isPlainValue(p.expression) && <FormulaMark />}
                        <span className="truncate text-sm text-muted group-aria-[current]:text-ink">
                          {featureName(doc, p)}
                        </span>
                      </span>
                      <ValueText evaluated={p} settings={settings} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** The small "ƒx" a formula gets in the list: its value follows other parameters. */
export function FormulaMark() {
  return (
    <span
      title="A formula"
      className="shrink-0 rounded-[4px] border border-sketch/60 px-1 font-mono text-xs text-ink italic"
    >
      ƒx
    </span>
  );
}

/** A row's value, or what is wrong: "loop" for a cycle, "error" for anything else. */
function ValueText({
  evaluated,
  settings,
}: {
  evaluated: EvaluatedParameter | undefined;
  settings: ExtrudoDocument['settings'];
}) {
  const result = evaluated?.result;
  if (!result) return null;
  if (result.ok) {
    return (
      <span className="font-mono text-field text-muted tabular-nums group-aria-[current]:text-ink">
        {formatQuantity(result.value, result.dim, settings)}
      </span>
    );
  }
  const loop = result.error.message.includes('refers to itself');
  return (
    <span className="font-mono text-field font-medium text-error" title={result.error.message}>
      {loop ? 'loop' : 'error'}
    </span>
  );
}
