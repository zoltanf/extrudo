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
import type { BodyOrigins } from './components';
import type { ConstructionReport } from './construction';
import { type HistoryEvent, type HistoryOptions, UndoHistory } from './history';
import type { AnnotationId, BodyId, ComponentId, FeatureId, JointId, SheetId } from './ids';
import type { ImportReport } from './import';
import type { MeshToSolidReport } from './mesh-to-solid';
import type { ExtrudoDocument, GeomRef, GeomRefKind } from './schema';
import type { SimplifyReport } from './simplify-for-print';
import type { Vec3 } from './sketch/planes';
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
  /**
   * The tag (a sketch's feature id) of the step `undo` would revert when it is
   * a reopenable sketch session (`UndoHistory.reopenTag`); undefined otherwise.
   */
  reopenTag: string | undefined;
  /** Applies a command and records it for undo. Throws `CommandError` and leaves the document unchanged if the command is invalid. */
  dispatch<P>(command: Command<P>): void;
  /**
   * Applies a command as part of the latest undo step instead of a step of
   * its own (`UndoHistory.amend`): for a change that follows from that step,
   * such as naming the bodies it made (ADR-0030). Undoing the step undoes
   * both. With no step to join (a freshly opened document), the change is
   * applied without one. Throws like `dispatch`. With `relabel`, the step
   * takes the command's label.
   */
  amend<P>(command: Command<P>, options?: { relabel?: boolean }): void;
  /**
   * Applies a command as part of the step `stepId` instead of a step of its
   * own (`UndoHistory.amendInto`, P6-07): for a change that follows from a past
   * step whose id the caller kept, such as an auto-projected constraint. The
   * patches apply to the current document (the change is made now); undoing
   * that past step later takes it along. Returns false when the step no longer
   * exists, so the caller can drop what followed from it. Throws like
   * `dispatch`.
   */
  amendInto<P>(stepId: number, command: Command<P>, options?: { relabel?: boolean }): boolean;
  /** The latest step's id, as `amend` would join, or undefined with no step (P6-07). */
  lastStepId(): number | undefined;
  /** Whether a step with this id is still in an undo stack (P6-07). */
  hasStep(stepId: number): boolean;
  undo(): void;
  redo(): void;
  /** Whether `revertTo(stepId)` would change the document (ADR-0111, `UndoHistory.canRevertTo`). */
  canRevertTo(stepId: number | undefined): boolean;
  /**
   * Undoes or redoes top-level steps until `stepId` is the latest (ADR-0111), in
   * one document change. Returns whether it changed the document.
   */
  revertTo(stepId: number | undefined): boolean;
  /** Opens a transaction; `reopen` makes its step reopenable (`UndoHistory.begin`). */
  beginTransaction(label: string, options?: { reopen?: string }): void;
  commitTransaction(): void;
  cancelTransaction(): void;
  /**
   * Reopens the latest step as the transaction it was committed from
   * (`UndoHistory.reopen`), the document unchanged. Returns its tag, or
   * undefined when the latest step isn't a reopenable session.
   */
  reopenTransaction(): string | undefined;
  /** Replaces the document (open, load a version) and clears the history. */
  replaceDocument(doc: ExtrudoDocument): void;
  /**
   * Calls `listener` after each change to the undo history above, with what it
   * did (ADR-0127: the recent-actions log): the command's type and label, the
   * step it made or joined. Also for a command that changed nothing. Not for a
   * command that threw. Returns the unsubscribe.
   */
  subscribeHistory(listener: (event: HistoryEvent) => void): () => void;
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
    reopenTag: history.reopenTag,
  });

  const listeners = new Set<(event: HistoryEvent) => void>();
  // After the store's own `set`, so a listener sees the new state. A listener
  // that throws never undoes or blocks the change: logging is a bystander.
  const emit = (event: HistoryEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // ignored
      }
    }
  };
  const amended = (
    command: Command<unknown>,
    into: number | undefined,
    changed: boolean,
    step: number | undefined,
    relabel: boolean,
  ) =>
    emit({
      type: 'amend',
      command: command.type,
      label: command.label,
      into,
      changed,
      step,
      stepLabel: step === undefined ? undefined : history.labelOf(step),
      relabel,
    });

  return createStore<DocumentState>()((set, get) => ({
    doc: freeze(initial, true),
    ...historyState(),
    dispatch(command) {
      const { doc, patches, inversePatches } = applyCommand(get().doc, command);
      const step = history.record({ label: command.label, patches, inversePatches });
      set({ doc, ...historyState() });
      emit({ type: 'dispatch', command: command.type, label: command.label, step });
    },
    amend(command, options) {
      const { doc, patches, inversePatches } = applyCommand(get().doc, command);
      const relabel = options?.relabel ?? false;
      if (patches.length === 0) {
        amended(command, undefined, false, history.lastStepId, relabel);
        return;
      }
      const step = history.lastStepId;
      history.amend({ label: command.label, patches, inversePatches }, relabel);
      set({ doc, ...historyState() });
      amended(command, undefined, true, step, relabel);
    },
    amendInto(stepId, command, options) {
      const { doc, patches, inversePatches } = applyCommand(get().doc, command);
      const relabel = options?.relabel ?? false;
      if (patches.length === 0) {
        const there = history.hasStep(stepId);
        amended(command, stepId, false, there ? stepId : undefined, relabel);
        return there;
      }
      const joined = history.amendInto(
        stepId,
        { label: command.label, patches, inversePatches },
        relabel,
      );
      if (joined) set({ doc, ...historyState() });
      amended(command, stepId, true, joined ? stepId : undefined, relabel);
      return joined;
    },
    lastStepId() {
      return history.lastStepId;
    },
    hasStep(stepId) {
      return history.hasStep(stepId);
    },
    undo() {
      const step = history.undoStepId;
      const label = history.undoLabel;
      set({ doc: history.undo(get().doc), ...historyState() });
      emit({ type: 'undo', step, label });
    },
    redo() {
      const step = history.redoStepId;
      const label = history.redoLabel;
      set({ doc: history.redo(get().doc), ...historyState() });
      emit({ type: 'redo', step, label });
    },
    canRevertTo(stepId) {
      return history.canRevertTo(stepId);
    },
    revertTo(stepId) {
      if (!history.canRevertTo(stepId)) {
        emit({ type: 'revert', target: stepId, changed: false });
        return false;
      }
      set({ doc: history.revertTo(get().doc, stepId), ...historyState() });
      emit({ type: 'revert', target: stepId, changed: true });
      return true;
    },
    beginTransaction(label, options) {
      history.begin(label, options?.reopen);
      set(historyState());
      emit({ type: 'begin', label, depth: history.depth });
    },
    commitTransaction() {
      const label = history.transactionLabel ?? '';
      const step = history.commit();
      set(historyState());
      emit({ type: 'commit', label, step, depth: history.depth });
    },
    reopenTransaction() {
      const step = history.undoStepId;
      const tag = history.reopen();
      if (tag === undefined) return undefined;
      set(historyState());
      emit({ type: 'reopen', label: history.transactionLabel ?? '', step, depth: history.depth });
      return tag;
    },
    cancelTransaction() {
      const label = history.transactionLabel ?? '';
      set({ doc: history.cancel(get().doc), ...historyState() });
      emit({ type: 'cancel', label, depth: history.depth });
    },
    replaceDocument(doc) {
      history.clear();
      set({ doc: freeze(doc, true), ...historyState() });
      emit({ type: 'replace' });
    },
    subscribeHistory(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  }));
}

/**
 * Something that can be selected or hovered: geometry, a feature, a
 * parameter, or a constraint or dimension of the open sketch (P1-06). A
 * point or curve of the open sketch is a `sketchEntity` (P1-09).
 */
export interface SelectionItem {
  /**
   * `annotation`: a numbered note (ADR-0126 §6), by its `AnnotationId`. `sheet`: something
   * on the open sheet, by its target (`item:<id>`, `view:<id>`, `title-block`; P6-24).
   */
  kind: GeomRefKind | 'feature' | 'parameter' | 'constraint' | 'dimension' | 'annotation' | 'sheet';
  id: string;
}

export type SelectMode = 'replace' | 'add' | 'toggle';

/**
 * The shell's edit modes (ADR-0143's S1a amendment): the model, an open sketch, or the
 * drawing's sheets (`sheet`, ADR-0143's S1 mode amendment). What each
 * shows (tabs, Finish tile, keymap and marking-menu mode) is the web app's `MODES` table
 * (`apps/web/src/shell/modes.ts`); a mode is entered and left with `enterMode`/`exitMode`.
 */
export type EditMode = 'model' | 'sketch' | 'sheet';

/** The session fields a mode other than the model owns; cleared on every mode change. */
type ModeFields = Pick<SessionState, 'activeSketchId' | 'activeSheetId'>;

export interface SessionState {
  mode: EditMode;
  /** The sketch being edited while `mode` is `sketch`. */
  activeSketchId: FeatureId | undefined;
  /** The sheet shown while `mode` is `sheet` (P6-24, ADR-0143). */
  activeSheetId: SheetId | undefined;
  /** Command-registry ID of the active tool, if any. */
  activeTool: string | undefined;
  selection: SelectionItem[];
  hover: SelectionItem | undefined;
  /**
   * Which side of the open sketch's plane the Slice removes (P4-12, ADR-0031
   * §5): +1 or −1 along the plane's normal. Decided when the sketch opens or
   * Slice is turned on — the side the camera is on then — and kept while the
   * camera moves, so orbiting to the other side doesn't flip the cut under
   * the person. Cleared when the sketch opens or closes, so the next one
   * decides afresh. Session state: not saved.
   */
  sketchSliceFlip: 1 | -1 | undefined;
  /**
   * The component new features are stamped into (P6-05 S4, ADR-0081 §6). Session state: not
   * saved, not undoable, kept across sketch mode.
   */
  activeComponent: ComponentId | undefined;
  /** The only component the view draws and picks while set (ADR-0081 §6). Session state. */
  isolatedComponent: ComponentId | undefined;
  /**
   * Enters a mode other than the model with its own fields (`activeSketchId` for a sketch,
   * `activeSheetId` for the drawing).
   * Every mode change clears the tool, the selection, the slice side and the other modes'
   * fields, in one store update.
   */
  enterMode(mode: Exclude<EditMode, 'model'>, fields?: Partial<ModeFields>): void;
  /** Back to the model, clearing what `enterMode` clears. */
  exitMode(): void;
  /** `enterMode('sketch', { activeSketchId: id })`. */
  enterSketch(id: FeatureId): void;
  /** `exitMode()`. */
  exitSketch(): void;
  setTool(tool: string | undefined): void;
  select(items: readonly SelectionItem[], mode?: SelectMode): void;
  clearSelection(): void;
  setHover(item: SelectionItem | undefined): void;
  setSketchSliceFlip(flip: 1 | -1 | undefined): void;
  activateComponent(id: ComponentId | undefined): void;
  isolateComponent(id: ComponentId | undefined): void;
}

export type SessionStore = StoreApi<SessionState>;

export function createSessionStore(): SessionStore {
  return createStore<SessionState>()((set, get) => ({
    mode: 'model',
    activeSketchId: undefined,
    activeSheetId: undefined,
    activeTool: undefined,
    selection: [],
    hover: undefined,
    sketchSliceFlip: undefined,
    activeComponent: undefined,
    isolatedComponent: undefined,
    enterMode(mode, fields) {
      set({ ...modeReset(), mode, ...fields });
    },
    exitMode() {
      set({ ...modeReset(), mode: 'model' });
    },
    enterSketch(id) {
      get().enterMode('sketch', { activeSketchId: id });
    },
    exitSketch() {
      get().exitMode();
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
    setSketchSliceFlip(sketchSliceFlip) {
      if (sketchSliceFlip !== get().sketchSliceFlip) set({ sketchSliceFlip });
    },
    activateComponent(activeComponent) {
      if (activeComponent !== get().activeComponent) set({ activeComponent });
    },
    isolateComponent(isolatedComponent) {
      if (isolatedComponent !== get().isolatedComponent) set({ isolatedComponent });
    },
  }));
}

/** What every mode change clears (`enterMode`, `exitMode`). */
function modeReset(): Pick<SessionState, 'activeTool' | 'selection' | 'sketchSliceFlip'> &
  ModeFields {
  return {
    activeSketchId: undefined,
    activeSheetId: undefined,
    activeTool: undefined,
    selection: [],
    sketchSliceFlip: undefined,
  };
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
  /**
   * A Mesh to Solid feature's report (P4-13, ADR-0097 §4): the result's faces
   * by surface kind. Absent for every other feature and when it failed.
   */
  meshToSolid?: MeshToSolidReport;
  /**
   * A Simplify for Print feature's report (ADR-0141 §4): the rounds, chamfers and holes
   * it found, each removed or not. Absent for every other feature and when it failed.
   */
  simplify?: SimplifyReport;
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

/**
 * What the kernel found for a joint at the marker (P6-05, ADR-0081 §4): its
 * frames resolved, the axis or direction read from side b, and whether side
 * a's frame agrees with it as built.
 */
export interface JointReport {
  /**
   * `ok`; `warning`: the frames disagree, or one was guessed; `error`: a frame
   * is lost or can't give an axis; `inactive`: a frame is on a feature the
   * marker has rolled back.
   */
  status: 'ok' | 'warning' | 'error' | 'inactive';
  message?: string;
  /** Frames the kernel lost or guessed, for Fix References (as `FeatureStatus.refs`). */
  refs?: ReferenceIssue[];
  /** A revolute's axis or a slider's direction (unit), read from side b's frame. */
  axis?: { origin: Vec3; direction: Vec3 };
  /** A revolute: how far a's axis is from b's, mm. */
  offset?: number;
  /**
   * The body each side's frame resolved on, where it is on one: the app checks
   * it is still in the side's component ("Hinge's moving frame isn't on Leaf").
   */
  bodies?: { a?: BodyId; b?: BodyId };
}

/**
 * Where the kernel found a `model` annotation at the marker (P6-23, ADR-0126
 * §4). `free` and `sketch` annotations are placed by the app and have none.
 */
export interface AnnotationReport {
  id: AnnotationId;
  /**
   * `ok`: the name resolved exactly; `moved`: by a related name or the
   * fingerprint (a guess, shown as a warning); `detached`: nothing resolves
   * (the geometry is gone, its feature deleted or rolled back).
   */
  status: 'ok' | 'moved' | 'detached';
  /** Where to draw it now, world mm (absent when detached: draw it at `anchor.at`). */
  at?: Vec3;
  /** The face normal at `at` when the reference is a face. */
  normal?: Vec3;
  /** What it resolved to now: the current name (with its fingerprint) and its body. */
  resolved?: { ref: GeomRef; body?: BodyId };
}

/** How the last recompute went, for the status bar. */
export interface ModelStats {
  ms: number;
  /** Features evaluated; the others came from the cache. */
  evaluated: number;
  reused: number;
}

/**
 * Where a running recompute is (P6-17, ADR-0105 §3): the reported feature and
 * its position among the active features, for the notice's progress bar and
 * the status bar. Set by the `Recomputer` at most once per animation frame;
 * `computing()` resets it, a result or a failure clears it.
 */
export interface ModelProgress {
  /** How many active features the kernel has reported so far. */
  done: number;
  /** The active features, before the marker and not suppressed. */
  total: number;
  /** The feature the kernel just reported. */
  feature: FeatureId;
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
  /**
   * What the kernel reports about each STEP import whose file has colours
   * (P4-12, ADR-0034's amendment): the bodies' colours, which the app takes
   * into `doc.bodies` once, when it first names a body.
   */
  imports: Record<FeatureId, ImportReport>;
  /**
   * Where each body the last recompute broke off another came from (P6-05,
   * ADR-0081 §2): a piece → the body it was cut from. The app reads it to put a
   * new piece in the component its source is in. Empty when no feature split a
   * body.
   */
  origins: BodyOrigins;
  /** What the last recompute found for each unsuppressed joint (P6-05, ADR-0081 §4). */
  joints: Record<JointId, JointReport>;
  /** Where the last recompute found each `model` annotation (P6-23, ADR-0126 §4). */
  annotations: Record<AnnotationId, AnnotationReport>;
  stats: ModelStats | undefined;
  /** Where a running recompute is; undefined unless one is running and reporting (P6-17). */
  progress: ModelProgress | undefined;
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
    imports?: Record<FeatureId, ImportReport>;
    origins?: BodyOrigins;
    joints?: Record<JointId, JointReport>;
    annotations?: Record<AnnotationId, AnnotationReport>;
    stats?: ModelStats;
    doc?: ExtrudoDocument;
  }): void;
  failed(error: string): void;
  /** Where a running recompute is, or undefined when it stopped reporting (P6-17). */
  setProgress(progress: ModelProgress | undefined): void;
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
    imports: {} as Record<FeatureId, ImportReport>,
    origins: {} as BodyOrigins,
    joints: {} as Record<JointId, JointReport>,
    annotations: {} as Record<AnnotationId, AnnotationReport>,
    stats: undefined,
    progress: undefined as ModelProgress | undefined,
    doc: undefined,
  });
  return createStore<ModelState<TBody>>()((set) => ({
    ...empty(),
    computing() {
      set({ status: 'computing', error: undefined, progress: undefined });
    },
    computed({
      features,
      bodies,
      sketches,
      construction,
      canvases,
      imports,
      origins,
      joints,
      annotations,
      stats,
      doc,
    }) {
      set((s) => ({
        status: 'ready',
        error: undefined,
        features,
        bodies,
        sketches: sketches ?? s.sketches,
        construction: construction ?? s.construction,
        canvases: canvases ?? s.canvases,
        imports: imports ?? s.imports,
        origins: origins ?? s.origins,
        joints: joints ?? s.joints,
        annotations: annotations ?? s.annotations,
        stats,
        progress: undefined,
        doc,
      }));
    },
    failed(error) {
      set({ status: 'failed', error, progress: undefined });
    },
    setProgress(progress) {
      set({ progress });
    },
    reset() {
      set(empty());
    },
  }));
}
