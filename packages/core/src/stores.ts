/**
 * App state as vanilla Zustand stores (architecture §1). They work without
 * React, so workers and tests can use them; the web app reads them through
 * `useStore`. Each is a factory, not a singleton: one set per open document.
 *
 * - **document**: the `ExtrudoDocument` and its undo history. The only way to
 *   change the document is `dispatch(command)`.
 * - **session**: editing state that isn't saved and isn't undoable: mode,
 *   active tool, selection, hover.
 * - **model**: what the kernel derived from the document: per-feature status
 *   and body meshes. Replaced wholesale after each recompute.
 */
import { freeze } from 'immer';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { applyCommand, type Command } from './commands';
import { type HistoryOptions, UndoHistory } from './history';
import type { BodyId, FeatureId } from './ids';
import type { ExtrudoDocument, GeomRefKind } from './schema';

export interface DocumentState {
  /** Deep-frozen. Never mutate it; dispatch a command. */
  doc: ExtrudoDocument;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
  /** Open transactions (sketch mode, feature dialog). 0 at the timeline level. */
  transactionDepth: number;
  /** Applies a command and records it for undo. Throws `CommandError` and leaves the document unchanged if the command is invalid. */
  dispatch<P>(command: Command<P>): void;
  undo(): void;
  redo(): void;
  beginTransaction(label: string): void;
  commitTransaction(): void;
  cancelTransaction(): void;
  /** Replaces the document (open, load a version) and clears the history. */
  replaceDocument(doc: ExtrudoDocument): void;
}

export type DocumentStore = StoreApi<DocumentState>;

export function createDocumentStore(
  initial: ExtrudoDocument,
  options: HistoryOptions = {},
): DocumentStore {
  const history = new UndoHistory(options);
  const historyState = () => ({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
    transactionDepth: history.depth,
  });

  return createStore<DocumentState>()((set, get) => ({
    doc: freeze(initial, true),
    ...historyState(),
    dispatch(command) {
      const { doc, patches, inversePatches } = applyCommand(get().doc, command);
      history.record({ label: command.label, patches, inversePatches });
      set({ doc, ...historyState() });
    },
    undo() {
      set({ doc: history.undo(get().doc), ...historyState() });
    },
    redo() {
      set({ doc: history.redo(get().doc), ...historyState() });
    },
    beginTransaction(label) {
      history.begin(label);
      set(historyState());
    },
    commitTransaction() {
      history.commit();
      set(historyState());
    },
    cancelTransaction() {
      set({ doc: history.cancel(get().doc), ...historyState() });
    },
    replaceDocument(doc) {
      history.clear();
      set({ doc: freeze(doc, true), ...historyState() });
    },
  }));
}

/** Something that can be selected or hovered: geometry, a feature, a parameter. */
export interface SelectionItem {
  kind: GeomRefKind | 'feature' | 'parameter';
  id: string;
}

export type SelectMode = 'replace' | 'add' | 'toggle';

export interface SessionState {
  mode: 'model' | 'sketch';
  /** The sketch being edited while `mode` is `sketch`. */
  activeSketchId: FeatureId | undefined;
  /** Command-registry ID of the active tool, if any. */
  activeTool: string | undefined;
  selection: SelectionItem[];
  hover: SelectionItem | undefined;
  enterSketch(id: FeatureId): void;
  exitSketch(): void;
  setTool(tool: string | undefined): void;
  select(items: readonly SelectionItem[], mode?: SelectMode): void;
  clearSelection(): void;
  setHover(item: SelectionItem | undefined): void;
}

export type SessionStore = StoreApi<SessionState>;

export function createSessionStore(): SessionStore {
  return createStore<SessionState>()((set, get) => ({
    mode: 'model',
    activeSketchId: undefined,
    activeTool: undefined,
    selection: [],
    hover: undefined,
    enterSketch(id) {
      set({ mode: 'sketch', activeSketchId: id, activeTool: undefined, selection: [] });
    },
    exitSketch() {
      set({ mode: 'model', activeSketchId: undefined, activeTool: undefined, selection: [] });
    },
    setTool(tool) {
      set({ activeTool: tool });
    },
    select(items, mode = 'replace') {
      set({ selection: nextSelection(get().selection, items, mode) });
    },
    clearSelection() {
      set({ selection: [] });
    },
    setHover(item) {
      const hover = get().hover;
      if (hover === item || (hover && item && sameItem(hover, item))) return;
      set({ hover: item });
    },
  }));
}

function sameItem(a: SelectionItem, b: SelectionItem): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function nextSelection(
  current: readonly SelectionItem[],
  items: readonly SelectionItem[],
  mode: SelectMode,
): SelectionItem[] {
  const has = (list: readonly SelectionItem[], item: SelectionItem) =>
    list.some((s) => sameItem(s, item));
  if (mode === 'replace') return items.filter((item, i) => !has(items.slice(0, i), item));
  const result = [...current];
  for (const item of items) {
    const index = result.findIndex((s) => sameItem(s, item));
    if (index < 0) result.push(item);
    else if (mode === 'toggle') result.splice(index, 1);
  }
  return result;
}

export interface FeatureStatus {
  status: 'ok' | 'warning' | 'error';
  message?: string;
}

/**
 * `TBody` is the kernel's body mesh type; core doesn't depend on the kernel,
 * so the app picks it (`createModelStore<BodyMesh>()`).
 */
export interface ModelState<TBody> {
  status: 'idle' | 'computing' | 'ready' | 'failed';
  /** Why the last recompute failed as a whole (for example, the kernel crashed). */
  error: string | undefined;
  features: Record<FeatureId, FeatureStatus>;
  bodies: Record<BodyId, TBody>;
  computing(): void;
  computed(result: {
    features: Record<FeatureId, FeatureStatus>;
    bodies: Record<BodyId, TBody>;
  }): void;
  failed(error: string): void;
  reset(): void;
}

export type ModelStore<TBody> = StoreApi<ModelState<TBody>>;

export function createModelStore<TBody>(): ModelStore<TBody> {
  const empty = () => ({
    status: 'idle' as const,
    error: undefined,
    features: {} as Record<FeatureId, FeatureStatus>,
    bodies: {} as Record<BodyId, TBody>,
  });
  return createStore<ModelState<TBody>>()((set) => ({
    ...empty(),
    computing() {
      set({ status: 'computing', error: undefined });
    },
    computed({ features, bodies }) {
      set({ status: 'ready', error: undefined, features, bodies });
    },
    failed(error) {
      set({ status: 'failed', error });
    },
    reset() {
      set(empty());
    },
  }));
}
