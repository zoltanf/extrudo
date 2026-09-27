import {
  type Command,
  CommandError,
  type DocumentStore,
  type FeatureId,
  type ModelStore,
  type OriginPlaneId,
  originPlaneRef,
  planeFrame,
  readSketch,
  type SessionStore,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useShortcuts } from '../commands/shortcuts';
import { useTheme } from '../design-system';
import { ParametersDialog } from '../parameters/ParametersDialog';
import type { Platform } from '../platform';
import type { Autosaver } from '../project/autosave';
import { useHostState } from '../sketch/hostState';
import {
  CREATE_SKETCH,
  cancelCreateSketch,
  createSketchOn,
  editSketch,
  finishSketch,
  lookAtSketch,
  type SketchModeStores,
  startCreateSketch,
} from '../sketch/mode';
import {
  OverConstrainedDialog,
  PanelColumn,
  PlanePrompt,
  SelectionPanel,
  SketchPalette,
} from '../sketch/panels';
import { deleteSelection } from '../sketch/selection';
import type { ToolHost } from '../sketch/tools/host';
import { isPickingTool, isSketchTool } from '../sketch/tools/ids';
import type { SketchDrawing } from '../viewport/sketchGeometry';
import type { ViewportStore } from '../viewport/store';
import type { PlanePicker, SketchInput } from '../viewport/Viewport';
import { AppBar, type FileActions } from './AppBar';
import { BROWSER_ID, BrowserPanel } from './BrowserPanel';
import { Splitter, usePanel } from './panels';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import type { ToolId } from './tools';

/** Drawing-tool shortcuts in sketch mode (UI spec §5). */
const TOOL_KEYS: Record<string, ToolId> = {
  L: 'line',
  R: 'rectangle',
  C: 'circle',
  A: 'arc',
  D: 'dimension',
};

// three.js loads in its own chunk, so the shell paints before it arrives.
const Viewport = lazy(() => import('../viewport/Viewport').then((m) => ({ default: m.Viewport })));
/** The drawing tools: their own chunk, loaded as soon as a project opens (ADR-0014). */
interface DrawingTools {
  host: ToolHost;
  Overlay: typeof import('../sketch/tools/SketchOverlay').SketchOverlay;
  Glyphs: typeof import('../sketch/tools/ConstraintGlyphs').ConstraintGlyphs;
  Labels: typeof import('../sketch/tools/DimensionLabels').DimensionLabels;
  Selection: typeof import('../sketch/tools/SelectionOverlay').SelectionOverlay;
}

export interface AppShellProps {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<BodyMesh>;
  viewport: ViewportStore;
  autosave: Autosaver;
  file: FileActions;
  platform: Platform;
  /** Shows a short message (a refused edit); the project page's toasts. */
  notify?(tone: 'info' | 'error', text: string): void;
}

/** The app shell (P0-04, UI spec §2): app bar, toolbar, browser, viewport, timeline. */
export function AppShell({
  store,
  session,
  model,
  viewport,
  autosave,
  file,
  platform,
  notify = () => {},
}: AppShellProps) {
  const { choice, setChoice } = useTheme(platform.preferences);
  const browser = usePanel(platform.preferences, { key: 'browser', size: 248, min: 180, max: 480 });
  const timeline = usePanel(platform.preferences, { key: 'timeline', size: 0, min: 0, max: 0 });
  const [parametersOpen, setParametersOpen] = useState(false);
  const bodies = useStore(model, (s) => s.bodies);
  const doc = useStore(store, (s) => s.doc);
  const mode = useStore(session, (s) => s.mode);
  const activeSketchId = useStore(session, (s) => s.activeSketchId);
  const activeTool = useStore(session, (s) => s.activeTool);
  const hover = useStore(session, (s) => s.hover);
  const picking = activeTool === CREATE_SKETCH;
  const drawing = mode === 'sketch' && isSketchTool(activeTool);
  const showConstraints = useStore(viewport, (s) => s.sketchConstraints);
  const showDimensions = useStore(viewport, (s) => s.sketchDimensions);

  const stores = useMemo<SketchModeStores>(
    () => ({ store, session, viewport }),
    [store, session, viewport],
  );

  // The drawing-tool host (P1-02). Made in an effect so Strict Mode's second mount gets a live
  // one. The overlay comes from the same chunk and renders directly: a lazy component would
  // suspend on the first tool, and React holds a suspended boundary back for a moment, long
  // enough to lose the first keys typed into the heads-up box.
  const [tools, setTools] = useState<DrawingTools>();
  const host = tools?.host;
  useEffect(() => {
    let h: ToolHost | undefined;
    let cancelled = false;
    Promise.all([
      import('../sketch/tools/host'),
      import('../sketch/tools/SketchOverlay'),
      import('../sketch/tools/ConstraintGlyphs'),
      import('../sketch/tools/DimensionLabels'),
      import('../sketch/tools/SelectionOverlay'),
    ]).then(
      ([
        { createToolHost },
        { SketchOverlay },
        { ConstraintGlyphs },
        { DimensionLabels },
        { SelectionOverlay },
      ]) => {
        if (cancelled) return;
        h = createToolHost({
          store,
          session,
          viewport,
          loadSolver: () => import('@extrudo/sketch/browser').then((m) => m.loadSketchSolver()),
        });
        setTools({
          host: h,
          Overlay: SketchOverlay,
          Glyphs: ConstraintGlyphs,
          Labels: DimensionLabels,
          Selection: SelectionOverlay,
        });
      },
    );
    return () => {
      cancelled = true;
      h?.dispose();
    };
  }, [store, session, viewport]);

  // Deleting a dimension another expression uses is refused; say why.
  const remove = useMemo(
    () => () => {
      try {
        deleteSelection(stores);
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        notify('error', error.message);
      }
    },
    [stores, notify],
  );
  // Parameter edits re-solve the sketches whose dimensions they change (P1-07).
  const apply = (command: Command<unknown>) => {
    if (host) host.apply(command);
    else store.getState().dispatch(command);
  };

  const shortcuts = useMemo(
    () => [
      { keys: 'Mod+Z', run: () => store.getState().undo() },
      { keys: 'Mod+Y', run: () => store.getState().redo() },
      { keys: 'Mod+Shift+Z', run: () => store.getState().redo() },
      ...(picking ? [{ keys: 'Escape', run: () => cancelCreateSketch(stores) }] : []),
      ...(mode === 'sketch' && host
        ? [
            ...Object.entries(TOOL_KEYS).map(([keys, tool]) => ({
              keys,
              run: () => host.start(tool),
            })),
            { keys: 'X', run: () => host.toggleConstruction() },
          ]
        : []),
      ...(drawing && host
        ? [
            { keys: 'Escape', run: () => host.escape() },
            { keys: 'Enter', run: () => host.enter() },
          ]
        : []),
      // The selection: geometry (P1-09), constraint glyphs (P1-06), dimension labels (P1-07).
      ...(mode === 'sketch' && !drawing
        ? [
            { keys: 'Delete', run: remove },
            { keys: 'Backspace', run: remove },
            {
              keys: 'Escape',
              // Esc puts dragged geometry back, or else clears the selection.
              run: () => {
                if (!host?.cancelMove()) session.getState().clearSelection();
              },
            },
          ]
        : []),
    ],
    [store, session, stores, picking, mode, drawing, host, remove],
  );
  useShortcuts(shortcuts);

  const run = (tool: ToolId) => {
    if (tool === 'parameters') setParametersOpen(true);
    else if (tool === 'sketch') {
      if (picking) cancelCreateSketch(stores);
      else startCreateSketch(stores);
    } else if (tool === 'finishSketch') finishSketch(stores);
    else if (isSketchTool(tool) && host) {
      if (activeTool === tool) host.stop();
      else host.start(tool);
    }
  };
  const pickPlane = (plane: OriginPlaneId) => createSketchOn(stores, originPlaneRef(plane));
  const edit = (id: FeatureId) => editSketch(stores, id);

  // Every active, unsuppressed sketch on a known plane is drawn; the open one in its status colours.
  const status = useHostState(host, (s) => s.status);
  const sketches = useMemo(() => {
    const out: SketchDrawing[] = [];
    doc.features.forEach((feature, index) => {
      if (index >= doc.timelineMarker || feature.suppressed) return;
      const sketch = readSketch(feature);
      const frame = sketch && planeFrame(sketch.plane);
      if (sketch && frame) {
        out.push({
          id: feature.id,
          frame,
          data: sketch.data,
          active: feature.id === activeSketchId,
          status: feature.id === activeSketchId ? status?.entities : undefined,
        });
      }
    });
    return out;
  }, [doc.features, doc.timelineMarker, activeSketchId, status]);
  const activeSketch = doc.features.find((f) => f.id === activeSketchId);
  const sketchPlane = sketches.find((s) => s.active)?.frame;

  // A drawing tool takes the pointer; with none running, the host selects and drags geometry
  // (P1-09). Until the host has loaded, a click in the view clears the selection.
  const sketchInput = useMemo<SketchInput | undefined>(() => {
    if (!sketchPlane) return undefined;
    if (!drawing && host) {
      return {
        frame: sketchPlane,
        onMove: host.move,
        onClick: host.click,
        onDragStart: host.dragStart,
        onDragEnd: host.dragEnd,
        onBox: host.box,
        onLeave: host.leave,
        cursor: 'default',
      };
    }
    if (drawing && host) {
      return {
        frame: sketchPlane,
        onMove: host.move,
        onClick: host.click,
        onDragStart: host.dragStart,
        onDragEnd: host.dragEnd,
        onLeave: host.leave,
        cursor: isPickingTool(activeTool) ? 'default' : 'crosshair',
      };
    }
    return {
      frame: sketchPlane,
      onMove: () => {},
      onClick: () => session.getState().clearSelection(),
      onLeave: () => {},
      cursor: 'default',
    };
  }, [drawing, host, sketchPlane, activeTool, session]);

  const planePicker = useMemo<PlanePicker | undefined>(
    () =>
      picking
        ? {
            hover: hover?.kind === 'plane' ? (hover.id as OriginPlaneId) : undefined,
            onHover: (plane) => session.getState().setHover({ kind: 'plane', id: plane }),
            onLeave: (plane) => {
              const current = session.getState().hover;
              if (current?.kind === 'plane' && current.id === plane) {
                session.getState().setHover(undefined);
              }
            },
            onPick: (plane) => createSketchOn(stores, originPlaneRef(plane)),
          }
        : undefined,
    [picking, hover, session, stores],
  );

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-bg text-ink">
      <AppBar
        store={store}
        autosave={autosave}
        file={file}
        theme={choice}
        onThemeChange={setChoice}
      />
      <Toolbar
        mode={mode}
        activeTool={picking ? 'sketch' : drawing ? (activeTool as ToolId) : undefined}
        onRun={run}
      />
      <main className="relative flex min-h-0">
        <BrowserPanel
          store={store}
          viewport={viewport}
          activeSketchId={activeSketchId}
          onEditSketch={edit}
          width={browser.size}
          collapsed={browser.collapsed}
          onToggle={browser.toggle}
        />
        {!browser.collapsed && (
          <Splitter
            label="Resize browser"
            controls={BROWSER_ID}
            size={browser.size}
            min={browser.min}
            max={browser.max}
            collapsed={browser.collapsed}
            onResize={browser.resize}
            onToggle={browser.toggle}
          />
        )}
        <Suspense
          fallback={
            <section
              aria-label="Viewport"
              aria-busy="true"
              className="min-w-0 flex-1"
              style={{ background: 'var(--x-viewport-glow)' }}
            />
          }
        >
          <Viewport
            viewport={viewport}
            bodies={bodies}
            meta={doc.bodies}
            sketches={sketches}
            sketchPlane={sketchPlane}
            planePicker={planePicker}
            sketchInput={sketchInput}
          >
            {showConstraints && tools && activeSketchId && sketchPlane && (
              <tools.Glyphs
                store={store}
                session={session}
                viewport={viewport}
                sketchId={activeSketchId}
                frame={sketchPlane}
                interactive={!drawing}
                over={status?.over}
              />
            )}
            {showDimensions && tools && activeSketchId && sketchPlane && (
              <tools.Labels
                store={store}
                session={session}
                viewport={viewport}
                host={tools.host}
                sketchId={activeSketchId}
                frame={sketchPlane}
                interactive={!drawing}
                notify={notify}
              />
            )}
            {!drawing && tools && activeSketchId && sketchPlane && (
              <tools.Selection
                store={store}
                session={session}
                viewport={viewport}
                sketchId={activeSketchId}
                frame={sketchPlane}
              />
            )}
            {mode === 'sketch' && activeSketch && !drawing && (
              <SelectionPanel
                store={store}
                session={session}
                host={host}
                onDelete={remove}
                notify={notify}
              />
            )}
            {drawing && tools && activeSketchId && sketchPlane && (
              <tools.Overlay
                host={tools.host}
                store={store}
                viewport={viewport}
                sketchId={activeSketchId}
                frame={sketchPlane}
              />
            )}
          </Viewport>
        </Suspense>
        {picking && (
          <PlanePrompt
            session={session}
            onPick={pickPlane}
            onCancel={() => cancelCreateSketch(stores)}
          />
        )}
        {mode === 'sketch' && activeSketch && (
          <PanelColumn>
            <SketchPalette
              name={activeSketch.name}
              viewport={viewport}
              host={host}
              onLookAt={() => lookAtSketch(stores)}
              onFinish={() => finishSketch(stores)}
            />
          </PanelColumn>
        )}
      </main>
      <Timeline
        store={store}
        collapsed={timeline.collapsed}
        onToggle={timeline.toggle}
        activeSketch={activeSketch?.name}
        onEditSketch={edit}
      />
      <OverConstrainedDialog host={host} />
      <ParametersDialog
        store={store}
        apply={apply}
        open={parametersOpen}
        onOpenChange={setParametersOpen}
      />
    </div>
  );
}
