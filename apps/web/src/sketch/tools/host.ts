/**
 * The sketch tool host (P1-02, ADR-0012): runs the active drawing tool.
 *
 * The viewport reports the pointer on the sketch plane; the host runs
 * inference (`@extrudo/sketch`), hands the result to the tool and keeps what
 * the preview and the heads-up box draw in a small store. When the tool
 * completes geometry, the host commits it as one `addToSketch` command
 * inside the sketch's undo transaction:
 *
 * 1. The tool's required constraints go in as they are.
 * 2. Each inferred constraint is test-solved (`SketchSolver.check`) and kept
 *    only if it neither conflicts nor is redundant.
 * 3. The sketch is solved, and the solved positions go into the same command.
 *
 * Constraints a constraint tool asks for (`SketchEdit.verify`, P1-06) are
 * test-solved before anything else: if one conflicts or is redundant, or the
 * solve would shrink a curve to nothing (`collapses`), the edit is refused
 * and the prompt says why. A new dimension (P1-07) that would over-constrain
 * the sketch waits for the user (`overConstrained`, P1-08): added as driven,
 * or not at all. A new driving dimension gets the next free parameter name
 * (`d1`…).
 *
 * Other changes that move sketch geometry (a dimension's value, a parameter
 * a dimension uses) go through `apply`: the command and the solves of every
 * sketch whose dimension values changed are one undo step.
 *
 * The host also keeps the open sketch's constraint status (P1-08, `status`):
 * which entities can still move, which are fully constrained and what
 * over-constrains the sketch. It solves the sketch again after every change;
 * components that didn't change cost nothing.
 *
 * With no tool running, the pointer selects and edits (P1-09): hovering
 * pre-highlights the entity under it (the session's `hover`), a click
 * selects it (Shift or Ctrl toggles), a drag that starts on an entity moves
 * it, or the whole selection if it is selected, with the solver's live drag
 * (one undo step), and `box` takes a window or crossing box from the
 * viewport. `moveTo` and `setRadius` are the properties panel's edits.
 * Where there is no entity, the pointer hovers and selects the closed
 * profile under it (P1-11, kind `profile`), while profiles are shown.
 *
 * Until the solver has loaded (a few ms after the first tool starts, or
 * after a sketch opens), edits go in with every inferred constraint and
 * unsolved, there is no status, and geometry can't be dragged.
 */
import {
  addProjection,
  addToSketch,
  CONSTRAINT_LABELS,
  type Command,
  CommandError,
  type ConstraintId,
  constraintRefs,
  DIMENSION_LABELS,
  type DimensionId,
  type DocumentStore,
  dimensionUnit,
  type ExtrudoDocument,
  entityPoints,
  evaluateParameters,
  type FeatureId,
  type GeomRef,
  includedCurves,
  includeLabel,
  includeProjection,
  measureDimension,
  modifySketch,
  nextModelParameterName,
  type ProjectionId,
  profileRefId,
  projectionSync,
  radiusOf,
  newId as randomId,
  readSketch,
  type SelectionItem,
  type SessionStore,
  type SketchConstraint,
  type SketchData,
  type SketchDimension,
  type SketchEntityId,
  type SketchProjection,
  type SketchReport,
  setSketchGeometry,
  syncProjections,
  UNITS,
  type Vec2,
} from '@extrudo/core';
import type { SketchSolution, SketchSolver } from '@extrudo/sketch';
// The inference entry point only: the solver's WASM glue stays in its own lazy chunk.
import {
  boxSelect,
  collapses,
  dimensionValues,
  type Inference,
  infer,
  type ModelSnap,
  pickEntity,
  type SketchSettleChange,
  SketchSettleError,
  type SketchStatus,
  settleSketches,
  sketchStatus,
  solveGradually,
} from '@extrudo/sketch/inference';
import { profileAt } from '@extrudo/sketch/profiles';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { gridStep } from '../../viewport/grid';
import type { ViewportStore } from '../../viewport/store';
import { sketchProfiles } from '../profiles';
import { focusTextField, resetTextDraft } from '../textDraft';
import { ARC_CENTER_TOOL, ARC_TANGENT_TOOL, ARC_TOOL, ArcTool } from './arc';
import { CIRCLE_2POINT_TOOL, CIRCLE_3POINT_TOOL, CIRCLE_TOOL, CircleTool } from './circle';
import { CONIC_TOOL, ConicTool, SPLINE_CONTROL_TOOL, SplineControlTool } from './conics';
import { CONSTRAINT_TOOLS, ConstraintTool } from './constrain';
import { CHAMFER_TOOL, CornerTool, FILLET_TOOL } from './corner';
import { DIMENSION_TOOL, DimensionTool } from './dimension';
import { labelOffset } from './dimensionLayout';
import { ELLIPSE_TOOL, EllipseTool } from './ellipse';
import { isSketchTool } from './ids';
import { IMPORT_DRAWING_TOOL, ImportDrawingTool } from './importDrawing';
import { LINE_TOOL, LineTool } from './line';
import { OFFSET_TOOL, OffsetTool } from './offset';
import { POINT_TOOL, PointTool } from './point';
import {
  POLYGON_CIRCUMSCRIBED_TOOL,
  POLYGON_EDGE_TOOL,
  POLYGON_TOOL,
  PolygonTool,
} from './polygon';
import {
  RECTANGLE_3POINT_TOOL,
  RECTANGLE_CENTER_TOOL,
  RECTANGLE_TOOL,
  RectangleTool,
} from './rectangle';
import { SLOT_OVERALL_TOOL, SLOT_TOOL, SlotTool } from './slot';
import { SPLINE_TOOL, SplineTool } from './spline';
import { BREAK_TOOL, EXTEND_TOOL, SplitTool, TRIM_TOOL } from './split';
import { TEXT_TOOL, TextTool } from './text';
import type { SketchEdit, SketchTool, ToolContext, Typed } from './tool';
import {
  CIRCULAR_PATTERN_TOOL,
  CircularPatternTool,
  COPY_TOOL,
  MIRROR_TOOL,
  MirrorTool,
  MOVE_TOOL,
  RECTANGULAR_PATTERN_TOOL,
  RectangularPatternTool,
  SCALE_TOOL,
  ScaleTool,
  TranslateTool,
} from './transform';

/** Snap distance, in screen pixels. */
export const SNAP_PIXELS = 8;

const FACTORIES: Record<string, (context: ToolContext) => SketchTool> = {
  [LINE_TOOL]: (context) => new LineTool(context),
  [RECTANGLE_TOOL]: (context) => new RectangleTool(context, '2-point'),
  [RECTANGLE_3POINT_TOOL]: (context) => new RectangleTool(context, '3-point'),
  [RECTANGLE_CENTER_TOOL]: (context) => new RectangleTool(context, 'center'),
  [CIRCLE_TOOL]: (context) => new CircleTool(context, 'center'),
  [CIRCLE_2POINT_TOOL]: (context) => new CircleTool(context, '2-point'),
  [CIRCLE_3POINT_TOOL]: (context) => new CircleTool(context, '3-point'),
  [ARC_TOOL]: (context) => new ArcTool(context, '3-point'),
  [ARC_CENTER_TOOL]: (context) => new ArcTool(context, 'center'),
  [ARC_TANGENT_TOOL]: (context) => new ArcTool(context, 'tangent'),
  [POINT_TOOL]: (context) => new PointTool(context),
  [POLYGON_TOOL]: (context) => new PolygonTool(context, 'inscribed'),
  [POLYGON_CIRCUMSCRIBED_TOOL]: (context) => new PolygonTool(context, 'circumscribed'),
  [POLYGON_EDGE_TOOL]: (context) => new PolygonTool(context, 'edge'),
  [SLOT_TOOL]: (context) => new SlotTool(context, 'center'),
  [SLOT_OVERALL_TOOL]: (context) => new SlotTool(context, 'overall'),
  [ELLIPSE_TOOL]: (context) => new EllipseTool(context),
  [SPLINE_TOOL]: (context) => new SplineTool(context),
  [SPLINE_CONTROL_TOOL]: (context) => new SplineControlTool(context),
  [CONIC_TOOL]: (context) => new ConicTool(context),
  [TEXT_TOOL]: (context) => new TextTool(context),
  [IMPORT_DRAWING_TOOL]: (context) => new ImportDrawingTool(context),
  [DIMENSION_TOOL]: (context) => new DimensionTool(context),
  [TRIM_TOOL]: (context) => new SplitTool(context, 'trim'),
  [EXTEND_TOOL]: (context) => new SplitTool(context, 'extend'),
  [BREAK_TOOL]: (context) => new SplitTool(context, 'break'),
  [FILLET_TOOL]: (context) => new CornerTool(context, 'fillet'),
  [CHAMFER_TOOL]: (context) => new CornerTool(context, 'chamfer'),
  [OFFSET_TOOL]: (context) => new OffsetTool(context),
  [MIRROR_TOOL]: (context) => new MirrorTool(context),
  [MOVE_TOOL]: (context) => new TranslateTool(context, 'move'),
  [COPY_TOOL]: (context) => new TranslateTool(context, 'copy'),
  [RECTANGULAR_PATTERN_TOOL]: (context) => new RectangularPatternTool(context),
  [CIRCULAR_PATTERN_TOOL]: (context) => new CircularPatternTool(context),
  [SCALE_TOOL]: (context) => new ScaleTool(context),
  ...Object.fromEntries(
    CONSTRAINT_TOOLS.map((id) => [id, (context: ToolContext) => new ConstraintTool(context, id)]),
  ),
};

/** The tools the host can run (`ids.ts` lists the same IDs for the shell). */
export const HOST_TOOL_IDS = Object.keys(FACTORIES);

export interface ToolHostState {
  tool: SketchTool | undefined;
  /** The last inferred pointer, in sketch mm. */
  pointer: Inference | undefined;
  /** The pointer in viewport pixels, for the heads-up box. */
  screen: readonly [number, number] | undefined;
  /** Bumped whenever the tool's preview, fields or prompt may have changed. */
  revision: number;
  /** Why the last edit couldn't be added. */
  error: string | undefined;
  /**
   * A new dimension would over-constrain the sketch (P1-08): the edit waits
   * until `resolveOverConstrained` adds it as driven or drops it.
   */
  overConstrained: { dimension: DimensionId; label: string } | undefined;
  /** The open sketch's constraint status; undefined until the solver has loaded. */
  status: SketchStatus | undefined;
  /** The dimension whose value is being edited in place (P1-07). */
  editing: DimensionId | undefined;
  solverReady: boolean;
  /** New curves are construction geometry (the X toggle, FR-SK-04). Resets when the sketch closes. */
  construction: boolean;
  /** A drawing tool has taken a pointer drag (the Line tool's tangent arc). */
  dragging: boolean;
  /** Selected geometry is being dragged (P1-09). */
  moving: boolean;
}

/** A pointer position on the sketch plane, from the viewport. */
export interface PlanePointer {
  /** Sketch coordinates, mm. */
  point: Vec2;
  /** mm per screen pixel at that point. */
  perPixel: number;
  /** Viewport pixels. */
  screen: readonly [number, number];
  /** False while the modifier that turns inference off is held. */
  infer: boolean;
  /** Shift, Ctrl or ⌘ is held: a click toggles the selection, a box adds to it (P1-09). */
  toggle?: boolean;
  /** The second of two clicks close together: double-clicking a text opens its panel (P4-03). */
  double?: boolean;
  /**
   * The body edge or vertex under the pointer, in sketch coordinates
   * (auto-project, P6-07). Absent when the preference is off, no body is under
   * the pointer, or the view offers no model geometry.
   */
  model?: ModelSnap;
}

/** A box drawn over the view (P1-09), as it lies on the sketch plane. */
export interface SketchBox {
  /** The screen rectangle's corners on the sketch plane, in order around it. */
  corners: Vec2[];
  /** Dragged left to right: a window takes what lies inside; a crossing box, what it touches. */
  mode: 'window' | 'crossing';
  /** Add to the selection rather than replace it. */
  add: boolean;
}

export interface ToolHostOptions {
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  /** Loads the solver on the first tool start (the browser build's `loadSketchSolver`). */
  loadSolver?: () => Promise<SketchSolver>;
  /** IDs for new geometry; random UUIDs by default. */
  newId?: () => string;
}

export interface ToolHost {
  readonly state: StoreApi<ToolHostState>;
  /** Starts a drawing tool in the open sketch (sets the session's active tool). */
  start(tool: string): void;
  /** Leaves the active drawing tool. */
  stop(): void;
  /** Selects what a box drawn over the view takes (no tool running). */
  box(box: SketchBox): void;
  /** Esc while dragging geometry: puts it back. False if nothing was being dragged. */
  cancelMove(): boolean;
  /**
   * Moves a point of the open sketch toward (x, y) as a drag would, the rest
   * following, as one undo step. Returns false if its constraints kept it
   * from getting there (it goes as near as they allow).
   */
  moveTo(point: SketchEntityId, x: number, y: number): boolean;
  /**
   * Sets a circle's or an arc's radius and solves the sketch, as one undo
   * step. Throws a `CommandError`, changing nothing, if its constraints or
   * dimensions don't allow it.
   */
  setRadius(curve: SketchEntityId, radius: number): void;
  move(pointer: PlanePointer): void;
  click(pointer: PlanePointer): void;
  /**
   * A press at `pointer` became a drag. True if it is taken: by the tool,
   * or with no tool, by the geometry under the press (which it moves). A
   * drag nobody takes is a selection box.
   */
  dragStart(pointer: PlanePointer): boolean;
  /** The drag ended at `pointer`. */
  dragEnd(pointer: PlanePointer): void;
  /** Flips whether new curves are construction geometry. */
  toggleConstruction(): void;
  /** The pointer left the viewport. */
  leave(): void;
  enter(): void;
  /** Esc: the tool steps back, and the host stops it when there is nothing left to cancel. */
  escape(): void;
  lock(field: string, typed: Typed | undefined): void;
  /**
   * Runs document commands, then solves every sketch whose dimension values
   * they changed and stores the solved geometry, as one undo step named
   * after the first command (P1-07: a dimension's new value, a parameter a
   * dimension uses, a parameter created inline). Throws a `CommandError`,
   * changing nothing, if a command is refused or a sketch can no longer be
   * solved.
   */
  apply(commands: Command<unknown> | readonly Command<unknown>[]): void;
  /** Opens a dimension of the open sketch for editing in place, or closes the editor. */
  editDimension(id: DimensionId | undefined): void;
  /** Answers `overConstrained`: add the dimension as driven (it measures), or drop the edit. */
  resolveOverConstrained(addDriven: boolean): void;
  /**
   * Brings every sketch's projected geometry in line with the kernel's
   * reports (P2-09, `projectionSync`) and solves the sketches that changed,
   * so geometry constrained to the projections follows. Both join the
   * latest undo step (`DocumentState.amend`): they follow from it. A sketch
   * that no longer solves keeps the best the solver found; its status then
   * shows the conflict. Until the solver has loaded, the solve waits for it.
   */
  syncProjections(reports: Readonly<Record<FeatureId, SketchReport>>): void;
  /** Stops listening and frees the solver. */
  dispose(): void;
}

/**
 * A point placed on a model snap (auto-project, P6-07) that waits for the
 * kernel to report the projected curve before its constraint can be written.
 */
interface PendingModelConstraint {
  feature: FeatureId;
  projection: ProjectionId;
  point: SketchEntityId;
  kind: 'vertex' | 'edge';
}

/**
 * A picking tool's constraint or dimension on body geometry (auto-project,
 * P6-07 slice 2) that waits for the kernel to report the projected entities:
 * every `binding` placeholder is replaced by its projection's curve, then the
 * constraint is test-solved and the dimension measured and written.
 */
interface PendingModelEdit {
  feature: FeatureId;
  bindings: { placeholder: SketchEntityId; projection: ProjectionId; kind: 'vertex' | 'edge' }[];
  constraints: Record<ConstraintId, SketchConstraint>;
  dimensions: { id: DimensionId; shape: SketchDimension }[];
  /** The Dimension tool's new dimension to open for editing once it lands. */
  editDimension?: DimensionId;
  /** Where a dimension's label goes, for re-measuring once the geometry lands. */
  cursor?: Vec2;
}

export function createToolHost(options: ToolHostOptions): ToolHost {
  const { store, session, viewport } = options;
  const newId = options.newId ?? (() => randomId());
  const state = createStore<ToolHostState>()(() => ({
    tool: undefined,
    pointer: undefined,
    screen: undefined,
    revision: 0,
    error: undefined,
    overConstrained: undefined,
    status: undefined,
    editing: undefined,
    solverReady: false,
    construction: false,
    dragging: false,
    moving: false,
  }));
  let solver: SketchSolver | undefined;
  let loading = false;
  let disposed = false;
  /** The document after our last commit: any other change (undo, redo) resets the tool. */
  let committed: ExtrudoDocument | undefined;
  let committing = false;
  /** mm per pixel at the last pointer: picking reaches `SNAP_PIXELS` of them. */
  let perPixel = 1;
  /** The body edge or vertex under the last pointer (auto-project, P6-07). */
  let lastModel: ModelSnap | undefined;
  /** The edit waiting for `resolveOverConstrained`. */
  let waiting: SketchEdit | undefined;
  /**
   * Constraints that wait for a projection's curve (auto-project, P6-07): the
   * projected entity doesn't exist until the kernel reports the curves, so the
   * host remembers what to hold and resolves it in `syncProjections`. Session
   * state only: it never enters the document.
   */
  const pendingModels: PendingModelConstraint[] = [];
  /** A picking tool's constraint or dimension waiting for a projection (P6-07 slice 2). */
  const pendingEdits: PendingModelEdit[] = [];
  /**
   * A drag on geometry with no tool (P1-09): points follow the pointer's offset, or, for a
   * drag on a circle's rim, the radius follows the pointer's distance from the centre.
   */
  let move:
    | { from: Vec2; rim?: { circle: SketchEntityId; center: Vec2; radius: number } }
    | undefined;
  /** The document and sketch the status was last worked out for. */
  let statusFor:
    | { doc: ExtrudoDocument; data: SketchData; values: Record<string, number> }
    | undefined;

  /**
   * Sketches whose projections moved before the solver loaded, with the
   * sketch before the first of those moves: solved once the solver is in.
   */
  const unsettled = new Map<FeatureId, SketchData | undefined>();

  /**
   * Solves a sketch as it is now and stores what moved, in the latest undo
   * step. `before` is the sketch before its projections moved: the solve
   * goes from there in steps (`solveGradually`), so geometry held at a
   * distance from a projected edge stays on its side when the edge moves far.
   */
  const settleProjections = (id: FeatureId, before?: SketchData) => {
    if (!solver) {
      if (!unsettled.has(id)) unsettled.set(id, before);
      ensureSolver();
      return;
    }
    const doc = store.getState().doc;
    const feature = doc.features.find((f) => f.id === id);
    const view = feature && readSketch(feature);
    if (!view) return;
    const values = dimensionValues(view.data, evaluateParameters(doc), id);
    const { solution } = before
      ? solveGradually(solver, before, view.data, values, values)
      : solver.solve(view.data, values);
    const points: Record<SketchEntityId, { x: number; y: number }> = {};
    const radii: Record<SketchEntityId, number> = {};
    for (const [key, p] of Object.entries(solution.points)) {
      const e = view.data.entities[key as SketchEntityId];
      if (e?.type === 'point' && (e.x !== p.x || e.y !== p.y)) {
        points[key as SketchEntityId] = { x: p.x, y: p.y };
      }
    }
    for (const [key, radius] of Object.entries(solution.radii)) {
      const e = view.data.entities[key as SketchEntityId];
      if (e?.type === 'circle' && e.radius !== radius) radii[key as SketchEntityId] = radius;
    }
    if (Object.keys(points).length + Object.keys(radii).length === 0) return;
    store.getState().amend(setSketchGeometry({ feature: id, points, radii }));
  };

  const bump = (patch: Partial<ToolHostState> = {}) =>
    state.setState((s) => ({ ...patch, revision: s.revision + 1 }));

  const activeSketch = (): { id: FeatureId; data: SketchData } | undefined => {
    const id = session.getState().activeSketchId;
    const feature = id && store.getState().doc.features.find((f) => f.id === id);
    const view = feature ? readSketch(feature) : undefined;
    return id && view ? { id, data: view.data } : undefined;
  };

  const context: ToolContext = {
    sketch: () => activeSketch()?.data ?? { entities: {}, constraints: {}, dimensions: {} },
    newId,
    construction: () => state.getState().construction,
    settings: () => store.getState().doc.settings,
    pick: (cursor, accept) => pickEntity(context.sketch(), cursor, SNAP_PIXELS * perPixel, accept),
    selection: () => {
      const data = activeSketch()?.data;
      return data ? selectedEntities(data) : [];
    },
    snapDistance: () => SNAP_PIXELS * perPixel,
    model: () => lastModel,
    pickModel: (cursor) => {
      const data = activeSketch()?.data;
      const snap = lastModel;
      if (!data || !snap || !viewport.getState().autoProject) return undefined;
      const tolerance = SNAP_PIXELS * perPixel;
      // The sketch's own geometry always wins, even one the tool wouldn't accept.
      if (pickEntity(data, cursor, tolerance)) return undefined;
      if (Math.hypot(snap.point[0] - cursor[0], snap.point[1] - cursor[1]) > tolerance) {
        return undefined;
      }
      const key = snap.kind === 'vertex' ? 'vertex' : 'edge';
      const existing = projectionFor(data, snap.ref);
      const curve = existing?.[1].curves[key];
      return { ...snap, ...(typeof curve === 'string' ? { entityId: curve } : {}) };
    },
  };

  const create = (id: string) => {
    const factory = FACTORIES[id];
    return factory ? factory(context) : undefined;
  };

  const ensureSolver = () => {
    if (solver || loading || !options.loadSolver) return;
    loading = true;
    options
      .loadSolver()
      .then((s) => {
        if (disposed) return s.dispose();
        solver = s;
        state.setState({ solverReady: true });
        if (unsettled.size > 0) {
          const pending = [...unsettled];
          unsettled.clear();
          const was = committing;
          committing = true;
          try {
            for (const [id, before] of pending) settleProjections(id, before);
          } finally {
            committing = was;
          }
        }
        refreshStatus();
      })
      .catch((error: unknown) => {
        loading = false;
        state.setState({ error: `The sketch solver didn't load: ${String(error)}` });
      });
  };

  const inferAt = (pointer: PlanePointer, tool: SketchTool): Inference => {
    const data = context.sketch();
    perPixel = pointer.perPixel;
    lastModel = viewport.getState().autoProject ? pointer.model : undefined;
    const model = !tool.picks ? lastModel : undefined;
    return infer(data, pointer.point, {
      tolerance: SNAP_PIXELS * pointer.perPixel,
      anchor: tool.anchor(),
      grid: viewport.getState().snap ? gridStep(pointer.perPixel) : undefined,
      enabled: pointer.infer && !tool.picks,
      ...(model && { model }),
    });
  };

  /** Solves the open sketch again if it changed, and stores its constraint status. */
  const refreshStatus = () => {
    // A solve would end the drag; the status can't change while geometry moves.
    if (move) return;
    const sketch = session.getState().mode === 'sketch' ? activeSketch() : undefined;
    if (!sketch || !solver) {
      statusFor = undefined;
      if (state.getState().status) state.setState({ status: undefined });
      return;
    }
    const { doc } = store.getState();
    if (statusFor?.doc === doc && statusFor.data === sketch.data) return;
    const values = dimensionValues(sketch.data, evaluateParameters(doc), sketch.id);
    const same = statusFor?.data === sketch.data && sameValues(values, statusFor.values);
    statusFor = { doc, data: sketch.data, values };
    if (same) return;
    const result = solver.solve(sketch.data, values);
    state.setState({ status: sketchStatus(sketch.data, result, values) });
  };

  /** Runs a command on the sketch; a `CommandError` becomes the prompt's error. */
  const dispatch = <P>(command: Command<P>): boolean => {
    committing = true;
    try {
      store.getState().dispatch(command);
      state.setState({ error: undefined });
      return true;
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      state.setState({ error: error.message });
      return false;
    } finally {
      committing = false;
      refreshStatus();
    }
  };

  /**
   * Solves every sketch whose driving dimension values differ from `before`
   * and stores what moved. The rule is `@extrudo/sketch`'s (`settleSketches`),
   * which the headless CLI uses too (ADR-0069), so a parameter drives geometry
   * the same way in the app and in a script. Throws a `CommandError` if a
   * sketch can't take the change.
   */
  const settle = (before: ExtrudoDocument, active: SketchSolver) => {
    let changes: SketchSettleChange[];
    try {
      changes = settleSketches({
        solver: active,
        before,
        after: store.getState().doc,
      });
    } catch (error) {
      if (error instanceof SketchSettleError) throw new CommandError(error.message);
      throw error;
    }
    for (const change of changes) {
      store.getState().dispatch(
        setSketchGeometry({
          feature: change.feature,
          points: change.points,
          radii: change.radii,
        }),
      );
    }
  };

  const commit = (edit: SketchEdit | undefined) => {
    if (!edit) return;
    const sketch = activeSketch();
    if (!sketch) return;
    if (edit.error) {
      state.setState({ error: edit.error });
      return;
    }
    if (edit.move) {
      moveBy(sketch, edit.move.entities, edit.move.by, edit.label ?? 'Move');
      return;
    }
    const { doc } = store.getState();
    const evaluation = evaluateParameters(doc);

    // Auto-project (P6-07): a point the tool placed on a body edge or vertex
    // projects the ref and holds the point on the projected geometry. A picking
    // tool (P6-07 slice 2) instead hands a placeholder its constraint or
    // dimension used; the host replaces it with the projected entity. An
    // already-projected ref is used at once; a new one waits for the kernel's
    // report (`syncProjections`).
    const newProjections: { id: ProjectionId; ref: GeomRef }[] = [];
    const deferredModels: PendingModelConstraint[] = [];
    const pickBindings: PendingModelEdit['bindings'] = [];
    const substitute = new Map<SketchEntityId, SketchEntityId>();
    for (const m of edit.models ?? []) {
      const key = m.kind === 'vertex' ? 'vertex' : 'edge';
      const existing = projectionFor(sketch.data, m.ref);
      const deleted =
        existing !== undefined && key in existing[1].curves && existing[1].curves[key] === null;
      const projected = deleted ? undefined : existing?.[1].curves[key];
      if (typeof projected === 'string') {
        if (m.placeholder) substitute.set(m.placeholder, projected);
        if (m.point) {
          const cid = newId() as ConstraintId;
          edit.constraints[cid] =
            m.kind === 'vertex'
              ? { type: 'coincident', a: m.point, b: projected }
              : { type: 'pointOnCurve', point: m.point, curve: projected };
          edit.auto = [...(edit.auto ?? []), cid];
        }
        continue;
      }
      const id = existing ? existing[0] : (newId() as ProjectionId);
      if (!existing) newProjections.push({ id, ref: m.ref });
      if (m.placeholder) {
        pickBindings.push({ placeholder: m.placeholder, projection: id, kind: m.kind });
      } else if (m.point) {
        deferredModels.push({ feature: sketch.id, projection: id, point: m.point, kind: m.kind });
      }
    }

    // A constraint or dimension that names an unresolved placeholder is set
    // aside until the projected entity lands; one whose placeholders all
    // resolved now is rewritten and goes in as usual.
    const pendingConstraints: Record<ConstraintId, SketchConstraint> = {};
    const pendingDimensions: PendingModelEdit['dimensions'] = [];
    if (substitute.size > 0 || pickBindings.length > 0) {
      const unresolved = new Set(pickBindings.map((b) => b.placeholder));
      const map = (id: SketchEntityId) => substitute.get(id) ?? id;
      for (const [id, c] of Object.entries(edit.constraints)) {
        if (constraintRefs(c).some((r) => unresolved.has(r))) {
          pendingConstraints[id as ConstraintId] = c;
          delete edit.constraints[id as ConstraintId];
        } else if (substitute.size > 0) {
          edit.constraints[id as ConstraintId] = mapConstraint(c, map);
        }
      }
      for (const [id, d] of Object.entries(edit.dimensions)) {
        if (dimensionRefs(d).some((r) => unresolved.has(r))) {
          pendingDimensions.push({ id: id as DimensionId, shape: d });
          delete edit.dimensions[id as DimensionId];
        } else if (substitute.size > 0) {
          edit.dimensions[id as DimensionId] = mapDimension(d, map);
        }
      }
    }

    const auto = new Set<string>(edit.auto);

    // New dimensions; the optional ones (`auto`) join them if the solver keeps them.
    const dimensions: Record<DimensionId, SketchDimension> = {};
    const optional: Record<DimensionId, SketchDimension> = {};
    for (const [id, d] of Object.entries(edit.dimensions)) {
      (auto.has(id) ? optional : dimensions)[id as DimensionId] = d;
    }
    // A linked dimension's parameter isn't in the document yet: it takes its target's value.
    // A dimension given a new expression (Scale) takes that one's.
    const values = (d: SketchData) => {
      const out = dimensionValues(d, evaluation, sketch.id);
      for (const [id, expr] of Object.entries(edit.exprs ?? {})) {
        const dim = d.dimensions[id as DimensionId];
        const result =
          dim && !dim.driven ? evaluation.evaluate(expr, dimensionUnit(dim)) : undefined;
        if (result?.ok) out[id] = result.value;
      }
      for (const [id, target] of Object.entries(edit.links ?? {})) {
        const v = out[target];
        if (id in d.dimensions && v !== undefined) out[id] = v;
      }
      return out;
    };

    // The sketch as the edit leaves what was there: removals, replacements, new expressions.
    const base = changedSketch(sketch.data, edit);
    const constraints: Record<ConstraintId, SketchConstraint> = {};
    for (const [id, c] of Object.entries(edit.constraints)) {
      if (!auto.has(id)) constraints[id as ConstraintId] = c;
    }
    const merged = (
      extra: Record<string, SketchConstraint>,
      extraDimensions: Record<string, SketchDimension> = {},
    ): SketchData => ({
      entities: { ...base.entities, ...edit.entities },
      constraints: { ...base.constraints, ...constraints, ...extra },
      dimensions: { ...base.dimensions, ...dimensions, ...extraDimensions },
    });
    for (const id of edit.verify ?? []) {
      const d = dimensions[id as DimensionId];
      if (d && !d.driven && solver) {
        const trial = merged({});
        if (solver.check(trial, values(trial), id).accepted) continue;
        // Over-constraining: the user decides whether it goes in as driven.
        waiting = edit;
        state.setState({
          overConstrained: { dimension: id as DimensionId, label: DIMENSION_LABELS[d.type] },
        });
        return;
      }
      const c = edit.constraints[id as ConstraintId];
      if (!c || !solver) continue;
      const trial = merged({});
      const result = solver.check(trial, values(trial), id);
      if (result.accepted) continue;
      const label = CONSTRAINT_LABELS[c.type];
      state.setState({
        error: result.redundant.includes(id)
          ? `${label} isn't needed: the sketch already holds it.`
          : `${label} would conflict with the sketch's other constraints.`,
      });
      return;
    }
    for (const id of edit.auto) {
      const c = edit.constraints[id as ConstraintId];
      const d = optional[id as DimensionId];
      if (!c && !d) continue;
      const trial = merged(c ? { [id]: c } : {}, d ? { [id]: d } : {});
      if (solver && !solver.check(trial, values(trial), id).accepted) continue;
      if (c) constraints[id as ConstraintId] = c;
      if (d) dimensions[id as DimensionId] = d;
    }

    let entities = edit.entities;
    const update = { ...edit.update };
    const points: Record<SketchEntityId, { x: number; y: number }> = {};
    const radii: Record<SketchEntityId, number> = {};
    if (solver) {
      const candidate = merged({});
      const { solution } = solver.solve(candidate, values(candidate));
      const asked = edit.verify?.[0] && edit.constraints[edit.verify[0] as ConstraintId];
      if (asked && collapses(candidate, solution)) {
        state.setState({
          error: `${CONSTRAINT_LABELS[asked.type]} would conflict with the sketch's other constraints.`,
        });
        return;
      }
      for (const id of edit.hold ?? []) {
        const want = candidate.entities[id];
        const got = solution.points[id];
        if (want?.type === 'point' && got && Math.hypot(got.x - want.x, got.y - want.y) > REACHED) {
          state.setState({
            error: `${edit.label ?? 'That'} can't be done: constraints hold some of it in place.`,
          });
          return;
        }
      }
      entities = { ...edit.entities };
      for (const [key, p] of Object.entries(solution.points)) {
        const id = key as SketchEntityId;
        const e = candidate.entities[id];
        if (e?.type !== 'point' || (e.x === p.x && e.y === p.y)) continue;
        if (id in edit.entities) entities[id] = { ...e, x: p.x, y: p.y };
        else if (id in update) update[id] = { ...e, x: p.x, y: p.y };
        else points[id] = { x: p.x, y: p.y };
      }
      for (const [key, radius] of Object.entries(solution.radii)) {
        const id = key as SketchEntityId;
        const e = candidate.entities[id];
        if (e?.type !== 'circle' || e.radius === radius) continue;
        if (id in edit.entities) entities[id] = { ...e, radius };
        else if (id in update) update[id] = { ...e, radius };
        else radii[id] = radius;
      }
    }

    // New driving dimensions take the next free parameter names; linked ones use their target's.
    let next = Number(nextModelParameterName(doc).slice(1));
    for (const [id, d] of Object.entries(dimensions)) {
      if (!d.driven && d.paramName === undefined) {
        dimensions[id as DimensionId] = { ...d, paramName: `d${next++}` };
      }
    }
    for (const [id, target] of Object.entries(edit.links ?? {})) {
      const d = dimensions[id as DimensionId];
      const to = dimensions[target];
      if (d && to?.paramName) dimensions[id as DimensionId] = { ...d, expr: to.paramName };
    }

    const addition = { feature: sketch.id, entities, constraints, dimensions, points, radii };
    const modifies =
      edit.label !== undefined ||
      edit.update !== undefined ||
      edit.replace !== undefined ||
      edit.remove !== undefined ||
      edit.exprs !== undefined;
    const added = dispatch(
      modifies
        ? modifySketch({
            ...addition,
            label: edit.label ?? 'Edit sketch',
            update,
            ...(edit.replace ? { replace: edit.replace } : {}),
            ...(edit.remove ? { remove: edit.remove } : {}),
            ...(edit.exprs ? { exprs: edit.exprs } : {}),
          })
        : addToSketch(addition),
    );
    if (added) {
      state.setState({
        editing:
          edit.editDimension && edit.editDimension in dimensions ? edit.editDimension : undefined,
      });
      // The projection records join the step that added the geometry (P6-07).
      for (const entry of newProjections) {
        try {
          store
            .getState()
            .amend(addProjection({ feature: sketch.id, id: entry.id, ref: entry.ref }));
        } catch (error) {
          if (!(error instanceof CommandError)) throw error;
          console.warn('[sketch] could not auto-project:', error);
        }
      }
      pendingModels.push(...deferredModels);
      if (pickBindings.length > 0) {
        pendingEdits.push({
          feature: sketch.id,
          bindings: pickBindings,
          constraints: pendingConstraints,
          dimensions: pendingDimensions,
          editDimension: edit.editDimension,
          cursor: edit.cursor,
        });
      }
    }
  };

  /** The Move tool: drags `ids` by `by` with the solver, the rest following, as one undo step. */
  const moveBy = (
    sketch: { id: FeatureId; data: SketchData },
    ids: readonly SketchEntityId[],
    by: Vec2,
    label: string,
  ) => {
    if (!solver || move) {
      state.setState({ error: 'The sketch solver is still loading.' });
      return;
    }
    const points = dragPoints(sketch.data, ids);
    solveOpen(solver, sketch);
    if (!solver.beginDrag(points)) {
      state.setState({ error: "Its constraints don't let it move." });
      return;
    }
    committing = true;
    store.getState().beginTransaction(label);
    let reached = false;
    try {
      const step = solver.dragBy(by[0], by[1]);
      if (step.ok) place(step.solution);
      reached =
        step.ok &&
        points.every((p) => {
          const was = sketch.data.entities[p];
          const now = step.solution.points[p];
          return (
            was?.type !== 'point' ||
            (now !== undefined && Math.hypot(now.x - was.x - by[0], now.y - was.y - by[1]) < 1e-6)
          );
        });
    } finally {
      solver.endDrag();
      store.getState().commitTransaction();
      committing = false;
      refreshStatus();
    }
    state.setState({
      error: reached ? undefined : 'Its constraints kept it from moving all the way.',
    });
  };

  /** The selected entities of the open sketch. */
  const selectedEntities = (data: SketchData): SketchEntityId[] =>
    session
      .getState()
      .selection.filter((s) => s.kind === 'sketchEntity' && s.id in data.entities)
      .map((s) => s.id as SketchEntityId);

  const pickAt = (pointer: PlanePointer): SketchEntityId | undefined => {
    const sketch = activeSketch();
    perPixel = pointer.perPixel;
    return sketch && pickEntity(sketch.data, pointer.point, SNAP_PIXELS * pointer.perPixel);
  };

  /** What a click with no tool takes: the entity under the pointer, else the profile. */
  const pickItem = (pointer: PlanePointer): SelectionItem | undefined => {
    const hit = pickAt(pointer);
    if (hit) return { kind: 'sketchEntity', id: hit };
    const sketch = activeSketch();
    if (!sketch || !viewport.getState().sketchProfiles) return undefined;
    const profile = profileAt(sketchProfiles(sketch.data), pointer.point);
    return profile && { kind: 'profile', id: profileRefId(sketch.id, profile.id) };
  };

  /** Clears a hover that the host set (an entity or a profile). */
  const clearHover = () => {
    const kind = session.getState().hover?.kind;
    if (kind === 'sketchEntity' || kind === 'profile') session.getState().setHover(undefined);
  };

  /** Stores a drag step's geometry where it differs from the open sketch's. */
  const place = (solution: SketchSolution) => {
    const sketch = activeSketch();
    if (!sketch) return;
    const points: Record<SketchEntityId, { x: number; y: number }> = {};
    const radii: Record<SketchEntityId, number> = {};
    for (const [key, p] of Object.entries(solution.points)) {
      const e = sketch.data.entities[key as SketchEntityId];
      if (e?.type === 'point' && (e.x !== p.x || e.y !== p.y)) {
        points[key as SketchEntityId] = { x: p.x, y: p.y };
      }
    }
    for (const [key, radius] of Object.entries(solution.radii)) {
      const e = sketch.data.entities[key as SketchEntityId];
      if (e?.type === 'circle' && e.radius !== radius) radii[key as SketchEntityId] = radius;
    }
    if (Object.keys(points).length + Object.keys(radii).length === 0) return;
    const was = committing;
    committing = true;
    try {
      store.getState().dispatch(setSketchGeometry({ feature: sketch.id, points, radii }));
    } finally {
      committing = was;
    }
  };

  /** Solves the open sketch as it is, so a drag starts from its current systems. */
  const solveOpen = (active: SketchSolver, sketch: { id: FeatureId; data: SketchData }) =>
    active.solve(
      sketch.data,
      dimensionValues(sketch.data, evaluateParameters(store.getState().doc), sketch.id),
    );

  /** The points that move when `ids` are dragged: points as they are, curves by theirs. */
  const dragPoints = (data: SketchData, ids: readonly SketchEntityId[]): SketchEntityId[] => {
    const out = new Set<SketchEntityId>();
    for (const id of ids) {
      const e = data.entities[id];
      if (!e) continue;
      if (e.type === 'point') out.add(id);
      else for (const p of entityPoints(e)) out.add(p);
    }
    return [...out];
  };

  /**
   * Starts resizing `id` if it's a circle whose radius the constraints leave free: a trial
   * pull shows whether the radius gives. The trial doesn't touch the document, and the
   * open sketch is solved again before the real drag starts from it.
   */
  const rimDrag = (
    active: SketchSolver,
    sketch: { id: FeatureId; data: SketchData },
    id: SketchEntityId,
  ) => {
    const circle = sketch.data.entities[id];
    if (circle?.type !== 'circle') return undefined;
    const solved = solveOpen(active, sketch);
    const radius = solved.solution.radii[id] ?? circle.radius;
    const stored = sketch.data.entities[circle.center];
    const center =
      solved.solution.points[circle.center] ??
      (stored?.type === 'point' ? { x: stored.x, y: stored.y } : undefined);
    if (!center || !active.beginRadiusDrag(id)) return undefined;
    const trial = active.dragRadius(radius + Math.max(0.5, radius * 0.1));
    const gives = trial.ok && Math.abs((trial.solution.radii[id] ?? radius) - radius) > 1e-6;
    active.endDrag();
    solveOpen(active, sketch);
    if (!gives || !active.beginRadiusDrag(id)) return undefined;
    return { circle: id, center: [center.x, center.y] as Vec2, radius };
  };

  const endMove = (keep: boolean) => {
    if (!move) return false;
    move = undefined;
    solver?.endDrag();
    if (keep) store.getState().commitTransaction();
    else store.getState().cancelTransaction();
    bump({ moving: false });
    refreshStatus();
    return true;
  };

  const run = (action: (tool: SketchTool) => SketchEdit | undefined) => {
    const tool = state.getState().tool;
    if (!tool) return;
    const edit = action(tool);
    if (edit) commit(edit);
    bump();
  };

  /**
   * Holds the points placed on auto-projected geometry (P6-07) once the kernel
   * has reported its curves: the constraint joins the step that added the
   * projection, and a solver that refuses it drops it with a message. Does
   * nothing while a projection's curve isn't there yet.
   */
  const resolvePendingModels = (feature: FeatureId, data: SketchData | undefined) => {
    if (!data || pendingModels.length === 0) return;
    for (let i = pendingModels.length - 1; i >= 0; i--) {
      const pending = pendingModels[i] as PendingModelConstraint;
      if (pending.feature !== feature) continue;
      const projection = data.projections?.[pending.projection];
      if (!projection) {
        pendingModels.splice(i, 1);
        continue;
      }
      const key = pending.kind === 'vertex' ? 'vertex' : 'edge';
      const curve = projection.curves[key];
      if (curve === undefined) continue;
      pendingModels.splice(i, 1);
      if (curve === null) continue;
      const cid = newId() as ConstraintId;
      const constraint: SketchConstraint =
        pending.kind === 'vertex'
          ? { type: 'coincident', a: pending.point, b: curve }
          : { type: 'pointOnCurve', point: pending.point, curve };
      const trial: SketchData = {
        entities: data.entities,
        constraints: { ...data.constraints, [cid]: constraint },
        dimensions: data.dimensions,
      };
      const trialValues = dimensionValues(trial, evaluateParameters(store.getState().doc), feature);
      if (solver && !solver.check(trial, trialValues, cid).accepted) {
        state.setState({
          error: 'The sketch already holds the point where auto-project would put it.',
        });
        continue;
      }
      try {
        store.getState().amend(addToSketch({ feature, constraints: { [cid]: constraint } }));
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        console.warn('[sketch] could not hold a point to an auto-projected curve:', error);
      }
    }
  };

  /**
   * Writes a picking tool's constraint or dimension on body geometry
   * (P6-07 slice 2) once the kernel reports the projected entities: every
   * placeholder is replaced by its projection's curve, the constraint is
   * test-solved, the dimension is measured and labelled, and both join the
   * step that added the projection. A projection whose curve isn't there yet
   * keeps waiting; a lost or deleted one drops the edit.
   */
  const resolvePendingEdits = (feature: FeatureId, data: SketchData | undefined) => {
    if (!data || pendingEdits.length === 0) return;
    const { doc } = store.getState();
    const evaluation = evaluateParameters(doc);
    const settings = doc.settings;
    for (let i = pendingEdits.length - 1; i >= 0; i--) {
      const pending = pendingEdits[i] as PendingModelEdit;
      if (pending.feature !== feature) continue;
      const map = new Map<SketchEntityId, SketchEntityId>();
      let status: 'ok' | 'waiting' | 'drop' = 'ok';
      for (const binding of pending.bindings) {
        const projection = data.projections?.[binding.projection];
        if (!projection) {
          status = 'drop';
          break;
        }
        const curve = projection.curves[binding.kind === 'vertex' ? 'vertex' : 'edge'];
        if (curve === undefined) {
          status = 'waiting';
          break;
        }
        if (curve === null) {
          status = 'drop';
          break;
        }
        map.set(binding.placeholder, curve);
      }
      if (status === 'waiting') continue;
      pendingEdits.splice(i, 1);
      if (status === 'drop') continue;
      const mapRef = (id: SketchEntityId) => map.get(id) ?? id;

      const constraints: Record<ConstraintId, SketchConstraint> = {};
      for (const [id, c] of Object.entries(pending.constraints)) {
        const mapped = mapConstraint(c, mapRef);
        const trial: SketchData = {
          entities: data.entities,
          constraints: { ...data.constraints, ...constraints, [id]: mapped },
          dimensions: data.dimensions,
        };
        const values = dimensionValues(trial, evaluation, feature);
        const result = solver?.check(trial, values, id as ConstraintId);
        if (result && !result.accepted) {
          const label = CONSTRAINT_LABELS[c.type];
          state.setState({
            error: result.redundant.includes(id as ConstraintId)
              ? `${label} isn't needed: the sketch already holds it.`
              : `${label} would conflict with the sketch's other constraints.`,
          });
          continue;
        }
        constraints[id as ConstraintId] = mapped;
      }

      const dimensions: Record<DimensionId, SketchDimension> = {};
      let next = Number(nextModelParameterName(store.getState().doc).slice(1));
      for (const { id, shape } of pending.dimensions) {
        const mapped = mapDimension(shape, mapRef);
        const view: SketchData = {
          entities: data.entities,
          constraints: { ...data.constraints, ...constraints },
          dimensions: { ...data.dimensions, ...dimensions },
        };
        const value = measureDimension(view, mapped);
        if (value === undefined) continue;
        const factor = mapped.type === 'angle' ? 1 : (UNITS[settings.units]?.factor ?? 1);
        const expr = String(Number((value / factor).toFixed(settings.precision)) + 0);
        const withExpr = { ...mapped, expr } as SketchDimension;
        const label = pending.cursor && labelOffset(view, withExpr, pending.cursor);
        const dimension = label ? { ...withExpr, label } : withExpr;
        const trial: SketchData = {
          entities: data.entities,
          constraints: { ...data.constraints, ...constraints },
          dimensions: { ...data.dimensions, ...dimensions, [id]: dimension },
        };
        const values = dimensionValues(trial, evaluation, feature);
        const result = solver?.check(trial, values, id);
        if (result && !result.accepted) {
          state.setState({
            error: `${DIMENSION_LABELS[shape.type]} would over-constrain the sketch.`,
          });
          continue;
        }
        dimensions[id] =
          !dimension.driven && dimension.paramName === undefined
            ? ({ ...dimension, paramName: `d${next++}` } as SketchDimension)
            : dimension;
      }

      if (Object.keys(constraints).length === 0 && Object.keys(dimensions).length === 0) continue;
      try {
        store.getState().amend(addToSketch({ feature, constraints, dimensions }));
        if (pending.editDimension && pending.editDimension in dimensions) {
          if (session.getState().activeSketchId === feature) {
            state.setState({ editing: pending.editDimension });
          }
        }
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        console.warn('[sketch] could not apply an auto-projected pick:', error);
      }
    }
  };

  const host: ToolHost = {
    state,
    start(id) {
      const s = session.getState();
      if (s.mode !== 'sketch' || !FACTORIES[id]) return;
      endMove(true);
      clearHover();
      // A Text tool's panel is closed when the tool starts (P4-03): a click opens it.
      if (id === TEXT_TOOL) resetTextDraft();
      s.setTool(id);
      committed = store.getState().doc;
      state.setState((prev) => ({
        tool: create(id),
        error: undefined,
        dragging: false,
        revision: prev.revision + 1,
      }));
      ensureSolver();
    },
    stop() {
      if (isSketchTool(session.getState().activeTool)) session.getState().setTool(undefined);
      bump({ tool: undefined, pointer: undefined, dragging: false });
    },
    move(pointer) {
      if (move) {
        const { from, rim } = move;
        // A rim keeps the pointer's offset from it: the radius changes as much as the
        // pointer's distance from the centre does.
        const step = rim
          ? solver?.dragRadius(
              Math.max(
                MIN_RADIUS,
                rim.radius +
                  Math.hypot(pointer.point[0] - rim.center[0], pointer.point[1] - rim.center[1]) -
                  Math.hypot(from[0] - rim.center[0], from[1] - rim.center[1]),
              ),
            )
          : solver?.dragBy(pointer.point[0] - from[0], pointer.point[1] - from[1]);
        if (step?.ok) place(step.solution);
        return;
      }
      if (!state.getState().tool) {
        if (session.getState().mode !== 'sketch') return;
        const item = pickItem(pointer);
        if (item) session.getState().setHover(item);
        else clearHover();
        return;
      }
      run((tool) => {
        const inference = inferAt(pointer, tool);
        tool.move(inference);
        state.setState({ pointer: inference, screen: pointer.screen });
        return undefined;
      });
    },
    click(pointer) {
      if (!state.getState().tool) {
        if (session.getState().mode !== 'sketch') return;
        const item = pickItem(pointer);
        const s = session.getState();
        if (item) s.select([item], pointer.toggle ? 'toggle' : 'replace');
        else if (!pointer.toggle) s.clearSelection();
        // A double-click on a text puts the cursor in the selection panel's
        // Text field, so the string can be typed right away (P4-03).
        if (pointer.double && item?.kind === 'sketchEntity') {
          const sketch = activeSketch();
          const entity = sketch?.data.entities[item.id as SketchEntityId];
          if (entity?.type === 'text') focusTextField(item.id);
        }
        return;
      }
      run((tool) => {
        const inference = inferAt(pointer, tool);
        // A new click answers the last refusal.
        state.setState({ pointer: inference, screen: pointer.screen, error: undefined });
        return tool.click(inference);
      });
    },
    dragStart(pointer) {
      const tool = state.getState().tool;
      if (tool) {
        const inference = inferAt(pointer, tool);
        const taken = tool.dragStart?.(inference) ?? false;
        if (taken) state.setState({ dragging: true });
        bump();
        return taken;
      }
      const sketch = session.getState().mode === 'sketch' ? activeSketch() : undefined;
      const hit = pickAt(pointer);
      if (!sketch || !hit) return false;
      // Geometry can't move before the solver is in; the press is still the entity's.
      if (!solver || move) return true;
      const selected = selectedEntities(sketch.data);
      const dragged = selected.includes(hit) ? selected : [hit];
      // A circle's rim resizes it when its radius can change (as in Fusion); else it moves.
      const rim = dragged.length === 1 ? rimDrag(solver, sketch, hit) : undefined;
      if (rim) {
        move = { from: pointer.point, rim };
        store.getState().beginTransaction('Resize');
        session.getState().setHover(undefined);
        bump({ moving: true });
        return true;
      }
      const points = dragPoints(sketch.data, dragged);
      solveOpen(solver, sketch);
      if (!solver.beginDrag(points)) return true;
      move = { from: pointer.point };
      store.getState().beginTransaction('Move');
      session.getState().setHover(undefined);
      bump({ moving: true });
      return true;
    },
    dragEnd(pointer) {
      if (move) {
        host.move(pointer);
        endMove(true);
        return;
      }
      if (!state.getState().dragging) return;
      state.setState({ dragging: false });
      run((tool) => {
        const inference = inferAt(pointer, tool);
        state.setState({ pointer: inference, screen: pointer.screen });
        return tool.dragEnd?.(inference);
      });
    },
    box({ corners, mode, add }) {
      const sketch = session.getState().mode === 'sketch' ? activeSketch() : undefined;
      if (!sketch || state.getState().tool) return;
      const ids = boxSelect(sketch.data, corners, mode);
      const s = session.getState();
      if (ids.length === 0 && !add) s.clearSelection();
      else
        s.select(
          ids.map((id) => ({ kind: 'sketchEntity', id })),
          add ? 'add' : 'replace',
        );
    },
    cancelMove() {
      return endMove(false);
    },
    moveTo(point, x, y) {
      const sketch = activeSketch();
      if (!sketch || !solver || move) return false;
      solveOpen(solver, sketch);
      if (!solver.beginDrag([point])) return false;
      store.getState().beginTransaction('Move point');
      let reached = false;
      try {
        const step = solver.drag(x, y);
        if (step.ok) place(step.solution);
        const p = step.solution.points[point];
        reached = step.ok && p !== undefined && Math.hypot(p.x - x, p.y - y) < REACHED;
      } finally {
        solver.endDrag();
        store.getState().commitTransaction();
        refreshStatus();
      }
      return reached;
    },
    setRadius(curve, radius) {
      const sketch = activeSketch();
      const e = sketch?.data.entities[curve];
      if (!sketch || !e || !(radius > 0)) return;
      const points: Record<SketchEntityId, { x: number; y: number }> = {};
      const radii: Record<SketchEntityId, number> = {};
      if (e.type === 'circle') radii[curve] = radius;
      else if (e.type === 'arc') {
        const c = sketch.data.entities[e.center];
        for (const id of [e.start, e.end]) {
          const p = sketch.data.entities[id];
          if (c?.type !== 'point' || p?.type !== 'point') return;
          const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
          points[id] = { x: c.x + ((p.x - c.x) * radius) / d, y: c.y + ((p.y - c.y) * radius) / d };
        }
      } else return;
      committing = true;
      store.getState().beginTransaction('Radius');
      try {
        store.getState().dispatch(setSketchGeometry({ feature: sketch.id, points, radii }));
        const moved = activeSketch();
        if (solver && moved) {
          const result = solveOpen(solver, moved);
          if (result.ok) place(result.solution);
        }
        const now = activeSketch();
        const r = now && radiusOf(now.data, curve);
        if (r === undefined || Math.abs(r - radius) > REACHED) {
          throw new CommandError(
            'Its constraints or dimensions set this radius; change them to change it.',
          );
        }
        store.getState().commitTransaction();
      } catch (error) {
        store.getState().cancelTransaction();
        throw error;
      } finally {
        committing = false;
        refreshStatus();
      }
    },
    toggleConstruction() {
      bump({ construction: !state.getState().construction });
    },
    leave() {
      clearHover();
      bump({ pointer: undefined, screen: undefined });
    },
    enter() {
      run((tool) => tool.enter());
    },
    escape() {
      const tool = state.getState().tool;
      if (!tool) return;
      if (tool.escape()) host.stop();
      else bump();
    },
    lock(field, typed) {
      run((tool) => {
        tool.lock(field, typed);
        return undefined;
      });
    },
    apply(commands) {
      const list = Array.isArray(commands) ? commands : [commands];
      const before = store.getState().doc;
      committing = true;
      try {
        // Until the solver is in (it loads when a project with dimensions opens), no solve.
        if (!solver) ensureSolver();
        store.getState().beginTransaction(list[0]?.label ?? 'Edit');
        try {
          for (const command of list) store.getState().dispatch(command);
          if (solver) settle(before, solver);
          store.getState().commitTransaction();
        } catch (error) {
          store.getState().cancelTransaction();
          throw error;
        }
      } finally {
        committing = false;
        refreshStatus();
      }
    },
    editDimension(id) {
      bump({ editing: id });
    },
    resolveOverConstrained(addDriven) {
      const edit = waiting;
      const pending = state.getState().overConstrained;
      waiting = undefined;
      state.setState({ overConstrained: undefined });
      const d = pending && edit?.dimensions[pending.dimension];
      if (addDriven && edit && pending && d) {
        const { paramName: _, ...rest } = d;
        commit({
          ...edit,
          dimensions: { ...edit.dimensions, [pending.dimension]: { ...rest, driven: true } },
        });
      }
      bump();
    },
    syncProjections(reports) {
      // A drag in progress holds the solver; the next recompute brings the reports again.
      if (move) return;
      const was = committing;
      committing = true;
      try {
        for (const feature of store.getState().doc.features) {
          const view = readSketch(feature);
          const report = reports[feature.id];
          if (!view?.data.projections || !report) continue;
          // An include (P4-12, "Keep linked" off): its curves become plain entities, the
          // record goes, and the step that added it is named for what it brought.
          for (const [id, include] of Object.entries(includedCurves(view.data, report, newId))) {
            try {
              const command = includeProjection({
                feature: feature.id,
                id: id as ProjectionId,
                entities: include.entities,
              });
              store
                .getState()
                .amend(
                  include.count > 0 ? { ...command, label: includeLabel(include.count) } : command,
                  { relabel: include.count > 0 },
                );
            } catch (error) {
              if (!(error instanceof CommandError)) throw error;
              console.warn(`[sketch] couldn't include into ${feature.name}:`, error);
            }
          }
          const current = readSketch(
            store.getState().doc.features.find((f) => f.id === feature.id) ?? feature,
          );
          if (!current?.data.projections) continue;
          const change = projectionSync(current.data, report, newId);
          if (!change) continue;
          try {
            store.getState().amend(syncProjections({ feature: feature.id, ...change }));
            const updated = readSketch(
              store.getState().doc.features.find((f) => f.id === feature.id) ?? feature,
            );
            resolvePendingModels(feature.id, updated?.data);
            resolvePendingEdits(feature.id, updated?.data);
            settleProjections(feature.id, current.data);
          } catch (error) {
            if (!(error instanceof CommandError)) throw error;
            console.warn(`[sketch] couldn't update the projections of ${feature.name}:`, error);
          }
        }
      } finally {
        committing = was;
        refreshStatus();
      }
    },
    dispose() {
      disposed = true;
      unsubscribeSession();
      unsubscribeStore();
      solver?.dispose();
      solver = undefined;
    },
  };

  // Leaving the sketch, or picking another tool, ends the drawing tool. An open
  // sketch needs the solver for its dimensions, so it loads then too.
  const unsubscribeSession = session.subscribe((s) => {
    const { tool, construction, editing } = state.getState();
    if (tool && (s.mode !== 'sketch' || s.activeTool !== tool.id)) {
      bump({ tool: undefined, pointer: undefined, dragging: false });
    }
    if (construction && s.mode !== 'sketch') bump({ construction: false });
    if (editing && s.mode !== 'sketch') bump({ editing: undefined });
    if (s.mode !== 'sketch' && move) endMove(false);
    if (s.mode !== 'sketch' && state.getState().overConstrained) {
      waiting = undefined;
      bump({ overConstrained: undefined });
    }
    if (s.mode === 'sketch') ensureSolver();
    refreshStatus();
  });
  // A sketch being edited, or dimensions a parameter change can move, need the solver.
  const dimensioned = store.getState().doc.features.some((f) => {
    const data = readSketch(f)?.data;
    // Projections (P2-09) move with the model and take the sketch along: a solve.
    return (
      Object.values(data?.dimensions ?? {}).some((d) => !d.driven) ||
      Object.keys(data?.projections ?? {}).length > 0
    );
  });
  if (session.getState().mode === 'sketch' || dimensioned) ensureSolver();
  // Undo or redo while drawing: the tool may hold points that no longer exist; start it afresh.
  const unsubscribeStore = store.subscribe((s) => {
    const tool = state.getState().tool;
    if (committing) {
      committed = s.doc;
      return;
    }
    if (tool && s.doc !== committed) {
      committed = s.doc;
      bump({ tool: create(tool.id), dragging: false });
    }
    refreshStatus();
  });

  return host;
}

/** Whether two sets of dimension values are the same (nothing to re-solve). */
function sameValues(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** How near (mm) an edit must get to the asked-for value to count as reached. */
const REACHED = 1e-6;

/** The smallest radius (mm) a rim drag asks for: dragging past the centre doesn't flip the circle. */
const MIN_RADIUS = 0.01;

/**
 * The sketch as an edit leaves what was already there: removals,
 * replacements and new expressions applied, nothing added yet.
 */
function changedSketch(data: SketchData, edit: SketchEdit): SketchData {
  const entities = { ...data.entities, ...edit.update };
  const constraints = { ...data.constraints, ...edit.replace?.constraints };
  const dimensions = { ...data.dimensions };
  for (const [id, d] of Object.entries(edit.replace?.dimensions ?? {})) {
    const old = dimensions[id as DimensionId];
    if (old)
      dimensions[id as DimensionId] = {
        ...d,
        driven: old.driven,
        paramName: old.paramName,
      } as SketchDimension;
  }
  for (const [id, expr] of Object.entries(edit.exprs ?? {})) {
    const d = dimensions[id as DimensionId];
    if (d) dimensions[id as DimensionId] = { ...d, expr };
  }
  for (const id of edit.remove?.entities ?? []) delete entities[id];
  for (const id of edit.remove?.constraints ?? []) delete constraints[id];
  for (const id of edit.remove?.dimensions ?? []) delete dimensions[id];
  return { entities, constraints, dimensions };
}

/**
 * The projection record a sketch already holds for a ref, with its ID, if it
 * has one (auto-project reuses it rather than projecting the same ref twice).
 */
function projectionFor(
  data: SketchData,
  ref: GeomRef,
): [ProjectionId, SketchProjection] | undefined {
  for (const [id, projection] of Object.entries(data.projections ?? {})) {
    if (
      projection.ref.kind === ref.kind &&
      projection.ref.id === ref.id &&
      (projection.mode ?? 'project') === 'project'
    ) {
      return [id as ProjectionId, projection];
    }
  }
  return undefined;
}

/** The entities a dimension refers to, in field order. */
function dimensionRefs(d: SketchDimension): SketchEntityId[] {
  switch (d.type) {
    case 'radius':
    case 'diameter':
      return [d.curve];
    case 'angle':
      return [d.a, d.b];
    default:
      return d.b === undefined ? [d.a] : [d.a, d.b];
  }
}

/** A constraint with every entity reference passed through `map` (auto-project, P6-07 slice 2). */
function mapConstraint(
  c: SketchConstraint,
  map: (id: SketchEntityId) => SketchEntityId,
): SketchConstraint {
  switch (c.type) {
    case 'pointOnCurve':
      return { ...c, point: map(c.point), curve: map(c.curve) };
    case 'midpoint':
      return { ...c, point: map(c.point), of: map(c.of) };
    case 'fix':
      return { ...c, entity: map(c.entity) };
    case 'horizontal':
    case 'vertical':
      return c.b === undefined ? { ...c, a: map(c.a) } : { ...c, a: map(c.a), b: map(c.b) };
    case 'symmetric':
      return { ...c, a: map(c.a), b: map(c.b), axis: map(c.axis) };
    default:
      return { ...c, a: map(c.a), b: map(c.b) };
  }
}

/** A dimension with every entity reference passed through `map` (auto-project, P6-07 slice 2). */
function mapDimension(
  d: SketchDimension,
  map: (id: SketchEntityId) => SketchEntityId,
): SketchDimension {
  switch (d.type) {
    case 'radius':
    case 'diameter':
      return { ...d, curve: map(d.curve) };
    case 'angle':
      return { ...d, a: map(d.a), b: map(d.b) };
    default:
      return d.b === undefined ? { ...d, a: map(d.a) } : { ...d, a: map(d.a), b: map(d.b) };
  }
}
