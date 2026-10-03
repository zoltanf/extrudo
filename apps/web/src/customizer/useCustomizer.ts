/**
 * The Customizer panel's logic (P4-07, ADR-0059 §1, §2 and §4), called from
 * `AppShell` next to the Parameters dialog:
 *
 * - the exposed parameters as rows, grouped as the panel shows them
 *   (`customizerRows` does the order; `groups` splits it into headings);
 * - which configuration the document has, if any (`currentConfigurations`
 *   matches the values, since nothing stores an "active" one), and what a
 *   configuration lists that is no longer there;
 * - every write goes through the shell's `apply`, so a parameter change
 *   re-solves the sketches whose dimensions use it in the same undo step
 *   (ADR-0016). That applies to applying a configuration too, which is why it
 *   goes through `setParameterExpressions` (one command, one undo step);
 * - a slider drag is **one** undo step: `beginDrag` opens a transaction in the
 *   document store (the one a sketch's Move drag uses, ADR-0003, ADR-0018),
 *   every value written while it drags lands inside it, and `endDrag` commits
 *   it. A keyboard step on the slider has no pointer down, so it is a command of
 *   its own, as it should be.
 */
import {
  addConfiguration,
  type Command,
  CommandError,
  type Configuration,
  type ConfigurationId,
  type CustomizerRow,
  capturedValues,
  configurationChanges,
  currentConfigurations,
  customizerRows,
  type DocumentStore,
  type EvaluateResult,
  type ExtrudoDocument,
  evaluateParameters,
  newId,
  type ParameterId,
  removeConfiguration,
  setParameterExpressions,
  updateConfiguration,
  updateParameter,
} from '@extrudo/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { rangeValue, snapValue, valueExpression } from '../parameters/customizer';
import { withParameterExpr } from '../parameters/drafts';

/** The session tool while the panel is open. */
export const CUSTOMIZER_TOOL = 'customizer';

/** One heading of the panel and the rows under it. */
export interface CustomizerGroup {
  group: string | undefined;
  rows: CustomizerRow[];
}

export interface CustomizerTool {
  /** Ungrouped parameters first, then each group in order (ADR-0059 §1). */
  groups: CustomizerGroup[];
  settings: ExtrudoDocument['settings'];
  configurations: Configuration[];
  /** The configuration whose values the document has, the first when several do. */
  current: Configuration | undefined;
  /** What `current` lists that no longer exists; empty most of the time. */
  missing: ParameterId[];
  /** The last refused command's message, cleared by the next write. */
  error: string | undefined;
  /** Evaluates a draft of one row's expression in the document. */
  evaluate(row: CustomizerRow, expression: string): EvaluateResult;
  /** Writes one row's expression: one command through `apply`. */
  setValue(row: CustomizerRow, expression: string): boolean;
  /** Opens the undo step a slider drag writes into. */
  beginDrag(row: CustomizerRow): void;
  /** A slider's new value: on the step, inside the range, as a plain expression. */
  dragTo(row: CustomizerRow, value: number): boolean;
  /** Closes the drag's undo step. */
  endDrag(): void;
  /** Applies a configuration: every value it lists, in one undo step. */
  choose(id: ConfigurationId): boolean;
  save(name: string): boolean;
  update(): boolean;
  rename(name: string): boolean;
  remove(): boolean;
}

export interface CustomizerOptions {
  store: DocumentStore;
  /**
   * Runs a command; the shell passes the same one the Parameters dialog gets,
   * which also re-solves the sketches whose dimensions change (ADR-0016).
   */
  apply(command: Command<unknown>): void;
}

export function useCustomizer({ store, apply }: CustomizerOptions): CustomizerTool {
  const doc = useStore(store, (s) => s.doc);
  const [error, setError] = useState<string>();
  // The row whose slider drag is open, which is also its undo transaction; the
  // state is only what puts the window listeners on.
  const dragging = useRef<CustomizerRow | undefined>(undefined);
  const [dragOpen, setDragOpen] = useState(false);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const settings = doc.settings;

  const groups = useMemo<CustomizerGroup[]>(() => {
    const out: CustomizerGroup[] = [];
    for (const row of customizerRows(doc, evaluation.parameters)) {
      const last = out.at(-1);
      if (last && last.group === row.group) last.rows.push(row);
      else out.push({ group: row.group, rows: [row] });
    }
    return out;
  }, [doc, evaluation]);
  const configurations = useMemo(() => doc.configurations ?? [], [doc]);
  const current = useMemo(() => {
    const id = currentConfigurations(doc)[0];
    return configurations.find((c) => c.id === id);
  }, [doc, configurations]);
  const missing = useMemo(() => {
    if (!current) return [];
    const live = new Set(doc.parameters.map((p) => p.id));
    return Object.keys(current.values).filter(
      (id) => !live.has(id as ParameterId),
    ) as ParameterId[];
  }, [doc, current]);

  /** Runs a command; a refused one says why instead of throwing. */
  const run = useCallback(
    (command: Command<unknown>): boolean => {
      try {
        apply(command);
        setError(undefined);
        return true;
      } catch (thrown) {
        if (!(thrown instanceof CommandError)) throw thrown;
        setError(thrown.message);
        return false;
      }
    },
    [apply],
  );

  const evaluate = useCallback(
    (row: CustomizerRow, expression: string): EvaluateResult => {
      const draft = withParameterExpr(doc, row.id, expression);
      const result = evaluateParameters(draft).parameters.get(row.name)?.result;
      return result ?? { ok: true, value: 0, dim: { length: 0, angle: 0 } };
    },
    [doc],
  );

  const write = useCallback(
    (row: CustomizerRow, expression: string) =>
      run(updateParameter({ id: row.id, changes: { expression } })),
    [run],
  );

  const beginDrag = useCallback(
    (row: CustomizerRow) => {
      // A transaction already open (a sketch, a dialog) keeps its own label.
      if (dragging.current || store.getState().transactionDepth > 0) return;
      dragging.current = row;
      setDragOpen(true);
      store.getState().beginTransaction(`Change ${row.name}`);
    },
    [store],
  );

  const dragTo = useCallback(
    (row: CustomizerRow, value: number) => {
      const min = row.min ?? 0;
      const max = row.max ?? value;
      return write(row, valueExpression(row.unit, snapValue(min, max, row.step, value), settings));
    },
    [write, settings],
  );

  const endDrag = useCallback(() => {
    const row = dragging.current;
    dragging.current = undefined;
    setDragOpen(false);
    if (row && store.getState().transactionDepth > 0) store.getState().commitTransaction();
  }, [store]);

  // The pointer can be let go anywhere (the slider takes the pointer, but a
  // keyboard or another window can end it too): one undo step per drag, never
  // an open transaction.
  useEffect(() => {
    if (!dragOpen) return;
    const end = () => endDrag();
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
    };
  }, [dragOpen, endDrag]);

  const choose = useCallback(
    (id: ConfigurationId) => {
      const changes = configurationChanges(doc, id);
      // Nothing to apply: the configuration is the one the document has.
      if (changes.length === 0) return true;
      return run(setParameterExpressions({ changes }));
    },
    [doc, run],
  );

  return {
    groups,
    settings,
    configurations,
    current,
    missing,
    error,
    evaluate,
    setValue: write,
    beginDrag,
    dragTo,
    endDrag,
    choose,
    save: (name) =>
      run(
        addConfiguration({
          configuration: { id: newId<ConfigurationId>(), name, values: capturedValues(doc) },
        }),
      ),
    update: () =>
      current === undefined
        ? false
        : run(
            updateConfiguration({
              id: current.id,
              changes: { values: capturedValues(doc, current.id) },
            }),
          ),
    rename: (name) =>
      current === undefined
        ? false
        : run(updateConfiguration({ id: current.id, changes: { name } })),
    remove: () => (current === undefined ? false : run(removeConfiguration({ id: current.id }))),
  };
}

/** What a row's slider shows: its value inside the range (ADR-0059 §1). */
export function sliderValue(row: CustomizerRow): number {
  if (row.min === undefined || row.max === undefined) return 0;
  return rangeValue(row.min, row.max, row.value);
}
