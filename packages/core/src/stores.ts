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
import type { CanvasReport } from './canvas';
import { applyCommand, type Command } from './commands';
import type { ConstructionReport } from './construction';
import { type HistoryOptions, UndoHistory } from './history';
import type { BodyId, FeatureId } from './ids';
import type { ExtrudoDocument, GeomRef, GeomRefKind } from './schema';
import type { SketchReport } from './sketch/projection';

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
  /**
   * Applies a command as part of the latest undo step instead of a step of
   * its own (`UndoHistory.amend`): for a change that follows from that step,
   * such as naming the bodies it made (ADR-0030). Undoing the step undoes
   * both. With no step to join (a freshly opened document), the change is
   * applied without one. Throws like `dispatch`.
   */
  amend<P>(command: Command<P>): void;
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
    amend(command) {
      const { doc, patches, inversePatches } = applyCommand(get().doc, command);
      if (patches.length === 0) return;
      history.amend({ label: command.label, patches, inversePatches });
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

/**
 * Something that can be selected or hovered: geometry, a feature, a
 * parameter, or a constraint or dimension of the open sketch (P1-06). A
 * point or curve of the open sketch is a `sketchEntity` (P1-09).
 */
export interface SelectionItem {
  kind: GeomRefKind | 'feature' | 'parameter' | 'constraint' | 'dimension';
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
  /**
   * References the kernel couldn't follow exactly (P2-11, ADR-0033): lost
   * ones and closest-match guesses. The timeline's "Fix references" reads
   * them. Absent when there are none.
   */
  refs?: ReferenceIssue[];
  /**
   * A Script feature's run (P5-02, ADR-0070): the features it made, what it
   * printed and, when it failed, where. Absent for every other feature.
   */
  script?: ScriptRunStatus;
}

/** What a Script feature's run did (`FeatureStatus.script`, ADR-0070). */
export interface ScriptRunStatus {
  /** The features it made, in order, with their own status. Empty when the run failed. */
  generated: GeneratedFeatureStatus[];
  /** What it printed with `console.log`, at most 200 lines. */
  log: string[];
  /** The line of the source the run failed on (1-based), when it failed and the engine could say. */
  line?: number;
  /** The column, when the engine gave one. */
  column?: number;
}

/** One feature a script made, as its status lists it. */
export interface GeneratedFeatureStatus {
  /** `<script>.f3`: the script's ID and the API's own (ADR-0070 §1). */
  id: FeatureId;
  /** "Script1 › Extrude1". */
  name: string;
  type: string;
  status: 'ok' | 'warning' | 'error';
  message?: string;
}

/**
 * A stored reference the kernel lost or guessed (ADR-0005 resolution,
 * ADR-0033). `ref` names it as stored (kind and ID; a feature may store the
 * same reference in several inputs).
 */
export interface ReferenceIssue {
  ref: { kind: GeomRefKind; id: string };
  /** `lost`: not found, the feature failed or skipped it; `guessed`: the closest match was taken. */
  state: 'lost' | 'guessed';
  /**
   * For a guess: a reference to what the kernel took (its current name and
   * fingerprint), when that differs from the stored one. Storing it in place
   * of `ref` ("Keep closest match") makes the reference exact again.
   */
  now?: GeomRef;
}

/** How the last recompute went, for the status bar. */
export interface ModelStats {
  ms: number;
  /** Features evaluated; the others came from the cache. */
  evaluated: number;
  reused: number;
}

/**
 * `TBody` is the kernel's body mesh type; core doesn't depend on the kernel,
 * so the app picks it (`createModelStore<BodyMesh>()`). The features and
 * bodies stay while a new recompute runs, until its result replaces them.
 */
export interface ModelState<TBody> {
  status: 'idle' | 'computing' | 'ready' | 'failed';
  /** Why the last recompute failed as a whole (for example, the kernel crashed). */
  error: string | undefined;
  features: Record<FeatureId, FeatureStatus>;
  bodies: Record<BodyId, TBody>;
  /**
   * What the kernel reports about each sketch it computed (P2-09): its
   * plane's frame (a sketch on a face follows the face) and projections.
   */
  sketches: Record<FeatureId, SketchReport>;
  /**
   * What the kernel reports about each construction plane, axis and point
   * (P3-05): where it is, for drawing, picking and as a sketch's frame.
   */
  construction: Record<FeatureId, ConstructionReport>;
  /**
   * What the kernel reports about each canvas (P4-06, ADR-0066 §5): the
   * frame of the plane its image lies on, which is all the geometry it has.
   */
  canvases: Record<FeatureId, CanvasReport>;
  stats: ModelStats | undefined;
  /**
   * The document `features` and `bodies` were computed from, when the
   * producer says (the `Recomputer` does): lets followers tell a result for
   * the current document from a stale one (body names, ADR-0030).
   */
  doc: ExtrudoDocument | undefined;
  computing(): void;
  computed(result: {
    features: Record<FeatureId, FeatureStatus>;
    bodies: Record<BodyId, TBody>;
    sketches?: Record<FeatureId, SketchReport>;
    construction?: Record<FeatureId, ConstructionReport>;
    canvases?: Record<FeatureId, CanvasReport>;
    stats?: ModelStats;
    doc?: ExtrudoDocument;
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
    sketches: {} as Record<FeatureId, SketchReport>,
    construction: {} as Record<FeatureId, ConstructionReport>,
    canvases: {} as Record<FeatureId, CanvasReport>,
    stats: undefined,
    doc: undefined,
  });
  return createStore<ModelState<TBody>>()((set) => ({
    ...empty(),
    computing() {
      set({ status: 'computing', error: undefined });
    },
    computed({ features, bodies, sketches, construction, canvases, stats, doc }) {
      set((s) => ({
        status: 'ready',
        error: undefined,
        features,
        bodies,
        sketches: sketches ?? s.sketches,
        construction: construction ?? s.construction,
        canvases: canvases ?? s.canvases,
        stats,
        doc,
      }));
    },
    failed(error) {
      set({ status: 'failed', error });
    },
    reset() {
      set(empty());
    },
  }));
}
