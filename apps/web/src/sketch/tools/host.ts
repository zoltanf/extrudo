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
 * and the prompt says why.
 *
 * Until the solver has loaded (a few ms after the first tool starts), edits
 * go in with every inferred constraint and unsolved.
 */
import {
  addToSketch,
  CONSTRAINT_LABELS,
  type Command,
  CommandError,
  type ConstraintId,
  type DocumentStore,
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureId,
  newId as randomId,
  readSketch,
  removeFromSketch,
  type SessionStore,
  type SketchConstraint,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import type { SketchSolution, SketchSolver } from '@extrudo/sketch';
// The inference entry point only: the solver's WASM glue stays in its own lazy chunk.
import { type Inference, infer, pickEntity } from '@extrudo/sketch/inference';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { gridStep } from '../../viewport/grid';
import type { ViewportStore } from '../../viewport/store';
import { dimensionValues } from '../values';
import { ARC_CENTER_TOOL, ARC_TANGENT_TOOL, ARC_TOOL, ArcTool } from './arc';
import { CIRCLE_2POINT_TOOL, CIRCLE_3POINT_TOOL, CIRCLE_TOOL, CircleTool } from './circle';
import { CONSTRAINT_TOOLS, ConstraintTool } from './constrain';
import { ELLIPSE_TOOL, EllipseTool } from './ellipse';
import { isSketchTool } from './ids';
import { LINE_TOOL, LineTool } from './line';
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
import type { SketchEdit, SketchTool, ToolContext, Typed } from './tool';

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
  solverReady: boolean;
  /** New curves are construction geometry (the X toggle, FR-SK-04). Resets when the sketch closes. */
  construction: boolean;
  /** A drawing tool has taken a pointer drag (the Line tool's tangent arc). */
  dragging: boolean;
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
  move(pointer: PlanePointer): void;
  click(pointer: PlanePointer): void;
  /** A press at `pointer` became a drag; the tool may take it. */
  dragStart(pointer: PlanePointer): void;
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
    solverReady: false,
    construction: false,
    dragging: false,
  }));
  let solver: SketchSolver | undefined;
  let loading = false;
  let disposed = false;
  /** The document after our last commit: any other change (undo, redo) resets the tool. */
  let committed: ExtrudoDocument | undefined;
  let committing = false;
  /** mm per pixel at the last pointer: picking reaches `SNAP_PIXELS` of them. */
  let perPixel = 1;

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
    pick: (cursor, accept) => pickEntity(context.sketch(), cursor, SNAP_PIXELS * perPixel, accept),
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

  /** Runs a command on the sketch; a `CommandError` becomes the prompt's error. */
  const dispatch = <P>(command: Command<P>) => {
    committing = true;
    try {
      store.getState().dispatch(command);
      state.setState({ error: undefined });
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      state.setState({ error: error.message });
    } finally {
      committing = false;
    }
  };

  const commit = (edit: SketchEdit | undefined) => {
    if (!edit) return;
    const sketch = activeSketch();
    if (!sketch) return;
    if (edit.remove?.length) {
      dispatch(removeFromSketch({ feature: sketch.id, constraints: edit.remove }));
      return;
    }
    const { doc } = store.getState();
    const evaluation = evaluateParameters(doc);
    const values = (d: SketchData) => dimensionValues(d, evaluation.evaluate);
    const auto = new Set<string>(edit.auto);

    const constraints: Record<ConstraintId, SketchConstraint> = {};
    for (const [id, c] of Object.entries(edit.constraints)) {
      if (!auto.has(id)) constraints[id as ConstraintId] = c;
    }
    const merged = (extra: Record<string, SketchConstraint>): SketchData => ({
      entities: { ...sketch.data.entities, ...edit.entities },
      constraints: { ...sketch.data.constraints, ...constraints, ...extra },
      dimensions: { ...sketch.data.dimensions, ...edit.dimensions },
    });
    for (const id of edit.verify ?? []) {
      const c = edit.constraints[id];
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
      const c = edit.constraints[id];
      if (!c) continue;
      const trial = merged({ [id]: c });
      if (!solver || solver.check(trial, values(trial), id).accepted) constraints[id] = c;
    }

    let entities = edit.entities;
    const points: Record<SketchEntityId, { x: number; y: number }> = {};
    const radii: Record<SketchEntityId, number> = {};
    if (solver) {
      const candidate = merged({});
      const { solution } = solver.solve(candidate, values(candidate));
      const asked = edit.verify?.[0] && edit.constraints[edit.verify[0]];
      if (asked && collapses(candidate, solution)) {
        state.setState({
          error: `${CONSTRAINT_LABELS[asked.type]} would conflict with the sketch's other constraints.`,
        });
        return;
      }
      entities = { ...edit.entities };
      const existing = sketch.data.entities;
      for (const [key, p] of Object.entries(solution.points)) {
        const id = key as SketchEntityId;
        const e = entities[id] ?? existing[id];
        if (e?.type !== 'point' || (e.x === p.x && e.y === p.y)) continue;
        if (id in edit.entities) entities[id] = { ...e, x: p.x, y: p.y };
        else points[id] = { x: p.x, y: p.y };
      }
      for (const [key, radius] of Object.entries(solution.radii)) {
        const id = key as SketchEntityId;
        const e = entities[id] ?? existing[id];
        if (e?.type !== 'circle' || e.radius === radius) continue;
        if (id in edit.entities) entities[id] = { ...e, radius };
        else radii[id] = radius;
      }
    }

    dispatch(
      addToSketch({
        feature: sketch.id,
        entities,
        constraints,
        dimensions: edit.dimensions,
        points,
        radii,
      }),
    );
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
      run((tool) => {
        const inference = inferAt(pointer, tool);
        tool.move(inference);
        state.setState({ pointer: inference, screen: pointer.screen });
        return undefined;
      });
    },
    click(pointer) {
      run((tool) => {
        const inference = inferAt(pointer, tool);
        // A new click answers the last refusal.
        state.setState({ pointer: inference, screen: pointer.screen, error: undefined });
        return tool.click(inference);
      });
    },
    dragStart(pointer) {
      run((tool) => {
        const inference = inferAt(pointer, tool);
        if (tool.dragStart?.(inference)) state.setState({ dragging: true });
        return undefined;
      });
    },
    dragEnd(pointer) {
      if (!state.getState().dragging) return;
      state.setState({ dragging: false });
      run((tool) => {
        const inference = inferAt(pointer, tool);
        state.setState({ pointer: inference, screen: pointer.screen });
        return tool.dragEnd?.(inference);
      });
    },
    toggleConstruction() {
      bump({ construction: !state.getState().construction });
    },
    leave() {
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
    dispose() {
      disposed = true;
      unsubscribeSession();
      unsubscribeStore();
      solver?.dispose();
      solver = undefined;
    },
  };

  // Leaving the sketch, or picking another tool, ends the drawing tool.
  const unsubscribeSession = session.subscribe((s) => {
    const { tool, construction } = state.getState();
    if (tool && (s.mode !== 'sketch' || s.activeTool !== tool.id)) {
      bump({ tool: undefined, pointer: undefined, dragging: false });
    }
    if (construction && s.mode !== 'sketch') bump({ construction: false });
  });
  // Undo or redo while drawing: the tool may hold points that no longer exist; start it afresh.
  const unsubscribeStore = store.subscribe((s) => {
    const tool = state.getState().tool;
    if (committing) committed = s.doc;
    else if (tool && s.doc !== committed) {
      committed = s.doc;
      bump({ tool: create(tool.id), dragging: false });
    }
  });

  return host;
}

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
