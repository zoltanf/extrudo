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
  addToSketch,
  CONSTRAINT_LABELS,
  type Command,
  CommandError,
  type ConstraintId,
  DIMENSION_LABELS,
  type DimensionId,
  type DocumentStore,
  dimensionUnit,
  type ExtrudoDocument,
  entityPoints,
  evaluateParameters,
  type FeatureId,
  modifySketch,
  nextModelParameterName,
  profileRefId,
  radiusOf,
  newId as randomId,
  readSketch,
  type SelectionItem,
  type SessionStore,
  type SketchConstraint,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
  setSketchGeometry,
  type Vec2,
} from '@extrudo/core';
import type { SketchSolution, SketchSolver } from '@extrudo/sketch';
// The inference entry point only: the solver's WASM glue stays in its own lazy chunk.
import {
  boxSelect,
  type Inference,
  infer,
  pickEntity,
  type SketchStatus,
  sketchStatus,
  unmetDimensions,
} from '@extrudo/sketch/inference';
import { profileAt } from '@extrudo/sketch/profiles';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { gridStep } from '../../viewport/grid';
import type { ViewportStore } from '../../viewport/store';
import { sketchProfiles } from '../profiles';
import { dimensionValues } from '../values';
import { ARC_CENTER_TOOL, ARC_TANGENT_TOOL, ARC_TOOL, ArcTool } from './arc';
import { CIRCLE_2POINT_TOOL, CIRCLE_3POINT_TOOL, CIRCLE_TOOL, CircleTool } from './circle';
import { CONSTRAINT_TOOLS, ConstraintTool } from './constrain';
import { CHAMFER_TOOL, CornerTool, FILLET_TOOL } from './corner';
import { DIMENSION_TOOL, DimensionTool } from './dimension';
import { ELLIPSE_TOOL, EllipseTool } from './ellipse';
import { isSketchTool } from './ids';
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
  /** Stops listening and frees the solver. */
  dispose(): void;
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
  /** The edit waiting for `resolveOverConstrained`. */
  let waiting: SketchEdit | undefined;
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
    return infer(data, pointer.point, {
      tolerance: SNAP_PIXELS * pointer.perPixel,
      anchor: tool.anchor(),
      grid: viewport.getState().snap ? gridStep(pointer.perPixel) : undefined,
      enabled: pointer.infer && !tool.picks,
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
   * and stores what moved. Throws a `CommandError` if a sketch that solved
   * before no longer does, or a curve collapses.
   */
  const settle = (before: ExtrudoDocument, active: SketchSolver) => {
    const doc = store.getState().doc;
    const was = evaluateParameters(before);
    const now = evaluateParameters(doc);
    for (const feature of doc.features) {
      const view = readSketch(feature);
      if (!view) continue;
      const old = before.features.find((f) => f.id === feature.id);
      const oldView = old && readSketch(old);
      const values = dimensionValues(view.data, now, feature.id);
      const oldValues = oldView ? dimensionValues(oldView.data, was, feature.id) : {};
      if (oldView && sameValues(values, oldValues)) continue;
      const result = active.solve(view.data, values);
      const unsolved = () => !oldView || active.solve(oldView.data, oldValues).ok;
      const refused = () =>
        new CommandError(
          `${feature.name} can't take that: its other constraints and dimensions don't allow it.`,
        );
      if ((!result.ok && unsolved()) || collapses(view.data, result.solution)) throw refused();
      // A dimension that starts driving must not over-constrain the sketch (P1-08).
      for (const id of Object.keys(values)) {
        if (id in oldValues || !(oldView?.data.dimensions[id as DimensionId]?.driven ?? false)) {
          continue;
        }
        if (!active.check(view.data, values, id).accepted) {
          const d = view.data.dimensions[id as DimensionId];
          throw new CommandError(
            `${d ? DIMENSION_LABELS[d.type] : 'That dimension'} would over-constrain the sketch, so it stays driven.`,
          );
        }
      }
      const points: Record<SketchEntityId, { x: number; y: number }> = {};
      const radii: Record<SketchEntityId, number> = {};
      for (const [key, p] of Object.entries(result.solution.points)) {
        const e = view.data.entities[key as SketchEntityId];
        if (e?.type === 'point' && (e.x !== p.x || e.y !== p.y)) {
          points[key as SketchEntityId] = { x: p.x, y: p.y };
        }
      }
      for (const [key, radius] of Object.entries(result.solution.radii)) {
        const e = view.data.entities[key as SketchEntityId];
        if (e?.type === 'circle' && e.radius !== radius) radii[key as SketchEntityId] = radius;
      }
      if (Object.keys(points).length > 0 || Object.keys(radii).length > 0) {
        store.getState().dispatch(setSketchGeometry({ feature: feature.id, points, radii }));
      }
      // planegcs can succeed by leaving a redundant dimension out: the new values must hold.
      const changed = Object.keys(values).filter((id) => values[id] !== oldValues[id]);
      const settled = store.getState().doc.features.find((f) => f.id === feature.id);
      const data = settled && readSketch(settled)?.data;
      if (data && unmetDimensions(data, values, changed).length > 0) throw refused();
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

  const host: ToolHost = {
    state,
    start(id) {
      const s = session.getState();
      if (s.mode !== 'sketch' || !FACTORIES[id]) return;
      endMove(true);
      clearHover();
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
  const dimensioned = store
    .getState()
    .doc.features.some((f) =>
      Object.values(readSketch(f)?.data.dimensions ?? {}).some((d) => !d.driven),
    );
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

function sameValues(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** How near (mm) an edit must get to the asked-for value to count as reached. */
const REACHED = 1e-6;

/** The smallest radius (mm) a rim drag asks for: dragging past the centre doesn't flip the circle. */
const MIN_RADIUS = 0.01;

/** Below this size (mm) a curve has collapsed: a solve that shrinks one this far failed in all but name. */
const COLLAPSED = 1e-3;

/**
 * Whether solving shrinks a line, circle, arc or ellipse of `before` to
 * almost nothing. planegcs satisfies some contradictions that way (two
 * horizontal lines made perpendicular become two dots) and reports success;
 * a constraint the user asked for that does this is refused as a conflict.
 */
export function collapses(before: SketchData, solution: SketchSolution): boolean {
  const after: SketchData = { ...before, entities: { ...before.entities } };
  const entities = after.entities as Record<string, SketchEntity>;
  for (const [id, p] of Object.entries(solution.points)) {
    const e = entities[id];
    if (e?.type === 'point') entities[id] = { ...e, x: p.x, y: p.y };
  }
  for (const [id, radius] of Object.entries(solution.radii)) {
    const e = entities[id];
    if (e?.type === 'circle') entities[id] = { ...e, radius };
  }
  const size = (data: SketchData, e: SketchEntity): number | undefined => {
    const at = (ref: SketchEntityId) => {
      const p = data.entities[ref];
      return p?.type === 'point' ? p : undefined;
    };
    const span = (a: SketchEntityId, b: SketchEntityId) => {
      const p = at(a);
      const q = at(b);
      return p && q ? Math.hypot(q.x - p.x, q.y - p.y) : undefined;
    };
    switch (e.type) {
      case 'line':
        return span(e.start, e.end);
      case 'circle':
        return e.radius;
      case 'arc':
        return span(e.center, e.start);
      case 'ellipse':
        return span(e.center, e.minor);
      default:
        return undefined;
    }
  };
  for (const [id, e] of Object.entries(before.entities)) {
    const was = size(before, e);
    const now = size(after, entities[id] ?? e);
    if (was !== undefined && now !== undefined && was >= COLLAPSED && now < COLLAPSED) return true;
  }
  return false;
}

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
