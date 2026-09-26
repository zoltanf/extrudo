import {
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
import { PlanePrompt, SketchPalette } from '../sketch/panels';
import { createToolHost, isSketchTool, type ToolHost } from '../sketch/tools/host';
import { SketchOverlay } from '../sketch/tools/SketchOverlay';
import type { SketchDrawing } from '../viewport/sketchGeometry';
import type { ViewportStore } from '../viewport/store';
import type { PlanePicker, SketchInput } from '../viewport/Viewport';
import { AppBar, type FileActions } from './AppBar';
import { BROWSER_ID, BrowserPanel } from './BrowserPanel';
import { Splitter, usePanel } from './panels';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import type { ToolId } from './tools';

// three.js loads in its own chunk, so the shell paints before it arrives.
const Viewport = lazy(() => import('../viewport/Viewport').then((m) => ({ default: m.Viewport })));

export interface AppShellProps {
  store: DocumentStore;
  session: SessionStore;
  model: ModelStore<BodyMesh>;
  viewport: ViewportStore;
  autosave: Autosaver;
  file: FileActions;
  platform: Platform;
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

  const stores = useMemo<SketchModeStores>(
    () => ({ store, session, viewport }),
    [store, session, viewport],
  );

  // The drawing-tool host (P1-02). Made in an effect so Strict Mode's second mount gets a live one.
  const [host, setHost] = useState<ToolHost>();
  useEffect(() => {
    const h = createToolHost({
      store,
      session,
      viewport,
      loadSolver: () => import('@extrudo/sketch/browser').then((m) => m.loadSketchSolver()),
    });
    setHost(h);
    return () => h.dispose();
  }, [store, session, viewport]);

  const shortcuts = useMemo(
    () => [
      { keys: 'Mod+Z', run: () => store.getState().undo() },
      { keys: 'Mod+Y', run: () => store.getState().redo() },
      { keys: 'Mod+Shift+Z', run: () => store.getState().redo() },
      ...(picking ? [{ keys: 'Escape', run: () => cancelCreateSketch(stores) }] : []),
      ...(mode === 'sketch' && host ? [{ keys: 'L', run: () => host.start('line') }] : []),
      ...(drawing && host
        ? [
            { keys: 'Escape', run: () => host.escape() },
            { keys: 'Enter', run: () => host.enter() },
          ]
        : []),
    ],
    [store, stores, picking, mode, drawing, host],
  );
  useShortcuts(shortcuts);

  const run = (tool: ToolId) => {
    if (tool === 'parameters') setParametersOpen(true);
    else if (tool === 'sketch') {
      if (picking) cancelCreateSketch(stores);
      else startCreateSketch(stores);
    } else if (tool === 'finishSketch') finishSketch(stores);
    else if (tool === 'line' && host) {
      if (activeTool === 'line') host.stop();
      else host.start('line');
    }
  };
  const pickPlane = (plane: OriginPlaneId) => createSketchOn(stores, originPlaneRef(plane));
  const edit = (id: FeatureId) => editSketch(stores, id);

  // Every active, unsuppressed sketch on a known plane is drawn.
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
        });
      }
    });
    return out;
  }, [doc.features, doc.timelineMarker, activeSketchId]);
  const activeSketch = doc.features.find((f) => f.id === activeSketchId);
  const sketchPlane = sketches.find((s) => s.active)?.frame;

  const sketchInput = useMemo<SketchInput | undefined>(
    () =>
      drawing && host && sketchPlane
        ? {
            frame: sketchPlane,
            onMove: host.move,
            onClick: host.click,
            onLeave: host.leave,
          }
        : undefined,
    [drawing, host, sketchPlane],
  );

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
            {drawing && host && activeSketchId && sketchPlane && (
              <SketchOverlay
                host={host}
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
          <SketchPalette
            name={activeSketch.name}
            viewport={viewport}
            onLookAt={() => lookAtSketch(stores)}
            onFinish={() => finishSketch(stores)}
          />
        )}
      </main>
      <Timeline
        store={store}
        collapsed={timeline.collapsed}
        onToggle={timeline.toggle}
        activeSketch={activeSketch?.name}
        onEditSketch={edit}
      />
      <ParametersDialog store={store} open={parametersOpen} onOpenChange={setParametersOpen} />
    </div>
  );
}
