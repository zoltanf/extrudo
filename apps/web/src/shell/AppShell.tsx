import {
  type BodyId,
  type Command,
  CommandError,
  type DocumentStore,
  type FeatureId,
  type GeomRef,
  isFeatureVisible,
  type ModelStore,
  type OriginPlaneId,
  originPlaneRef,
  readSketch,
  redefineSketchPlane,
  type SelectionItem,
  type SessionStore,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { type CSSProperties, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { keysFor } from '../commands/keymap';
import { isEditable, useShortcuts } from '../commands/shortcuts';
import { type Toast, type ToastOptions, Toasts, ToolIcon, useTheme } from '../design-system';
import { ExportModelDialog, type ModelExportRequest } from '../export/ExportModelDialog';
import type { ModelExporter } from '../export/modelExport';
import { DialogOverlay } from '../features/DialogOverlay';
import { type DialogKernel, dialogBodies, viewPreview } from '../features/dialog';
import { FeatureDialog } from '../features/FeatureDialog';
import { dialogPlanePick, dialogPlanePicker } from '../features/planePicker';
import { type FeatureDialogs, featureDialogs, specForCommand } from '../features/registry';
import { useDialogItems, useFeatureDialogs } from '../features/useFeatureDialogs';
import { ParametersDialog } from '../parameters/ParametersDialog';
import type { Platform } from '../platform';
import type { Autosaver } from '../project/autosave';
import { readTopology, sketchEntityIdsIn } from '../selection/items';
import { useModelSelection } from '../selection/useModelSelection';
import { useBodiesBefore } from '../sketch/baseBodies';
import { type ExportRequest, ExportSketchDialog } from '../sketch/ExportSketchDialog';
import { sketchFrame } from '../sketch/frame';
import { useHostState } from '../sketch/hostState';
import {
  CREATE_SKETCH,
  cancelCreateSketch,
  createSketchOn,
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
import { profileIdsIn, sketchProfiles } from '../sketch/profiles';
import { PROJECT_TOOL, useProjectTool } from '../sketch/project';
import { deleteSelection } from '../sketch/selection';
import type { ToolHost } from '../sketch/tools/host';
import { isPickingTool, isSketchTool } from '../sketch/tools/ids';
import type { SketchDrawing } from '../viewport/sketchGeometry';
import type { ViewportStore } from '../viewport/store';
import type { PlanePicker, SketchInput } from '../viewport/Viewport';
import { AppBar, type FileActions } from './AppBar';
import { BROWSER_ID, BrowserPanel } from './BrowserPanel';
import { bodyEntries, bodyMetaOf, createBodyActions, followBodyNames } from './bodies';
import { CommandSearch, type SearchOpen } from './CommandSearch';
import { type AppCommand, buildCommands, commandShortcuts } from './commands';
import { createFeatureActions } from './featureActions';
import { Splitter, usePanel } from './panels';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import type { ToolId } from './tools';

/** The toolbox's pins until the user changes them (P1-14). */
const DEFAULT_PINS = ['sketch', 'line', 'rectangle', 'circle', 'dimension', 'trim', 'parameters'];
const PINS_KEY = 'toolbox.pins';
const RECENT = 8;

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
  notify?(tone: 'info' | 'error', text: string, options?: ToastOptions): void;
  /**
   * The project page's toasts (`useToasts`), drawn in the view's bottom-right
   * corner, or at the foot of the sketch palette while a sketch is open.
   */
  toasts?: { toasts: Toast[]; onDismiss(id: number): void };
  /** Feature dialogs (P2-05): the app's registry unless a debug page brings its own. */
  dialogs?: FeatureDialogs;
  /** The project's kernel (its `Recomputer`): dialog previews, references and export. */
  kernel?: DialogKernel & ModelExporter;
}

/** The app's feature dialogs (`features/registry.ts`). */
const APP_DIALOGS = featureDialogs();

/**
 * The browser's own right-click menu ("Copy, Select all") has nothing for a
 * CAD app outside text fields, links and selected text, and it gets in the
 * way of right-button orbiting (Onshape preset). Our menus (timeline chips,
 * browser rows) open as before: they handle the event first. Dialogs in
 * portals are covered too, since the listener is on the window.
 */
function keepNativeMenuOut(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (isEditable(target) || target?.closest('a[href]')) return;
  if (globalThis.getSelection?.()?.toString()) return;
  event.preventDefault();
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
  toasts,
  dialogs = APP_DIALOGS,
  kernel,
}: AppShellProps) {
  const { choice, setChoice } = useTheme(platform.preferences);
  const browser = usePanel(platform.preferences, { key: 'browser', size: 248, min: 180, max: 480 });
  const timeline = usePanel(platform.preferences, { key: 'timeline', size: 0, min: 0, max: 0 });
  // The browser floats over the view's left edge: fitting frames the part it leaves open.
  const browserCover = browser.collapsed ? 0 : browser.size;
  useEffect(() => viewport.getState().setCover(browserCover), [viewport, browserCover]);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [exportRequest, setExportRequest] = useState<ExportRequest>();
  const [modelExport, setModelExport] = useState<ModelExportRequest>();
  const bodies = useStore(model, (s) => s.bodies);
  const sketchReports = useStore(model, (s) => s.sketches);
  const doc = useStore(store, (s) => s.doc);
  const mode = useStore(session, (s) => s.mode);
  const activeSketchId = useStore(session, (s) => s.activeSketchId);
  const activeTool = useStore(session, (s) => s.activeTool);
  const hover = useStore(session, (s) => s.hover);
  const picking = activeTool === CREATE_SKETCH;
  const drawing = mode === 'sketch' && isSketchTool(activeTool);
  const projecting = mode === 'sketch' && activeTool === PROJECT_TOOL;
  const showConstraints = useStore(viewport, (s) => s.sketchConstraints);
  const showDimensions = useStore(viewport, (s) => s.sketchDimensions);
  const showProfiles = useStore(viewport, (s) => s.sketchProfiles);
  const selection = useStore(session, (s) => s.selection);

  const stores = useMemo<SketchModeStores>(
    () => ({ store, session, viewport, model }),
    [store, session, viewport, model],
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

  // Projected geometry follows the model (P2-09): after each recompute of the current
  // document, the host brings the sketches in line with the kernel's reports.
  useEffect(() => {
    if (!host) return;
    const sync = (s: ReturnType<typeof model.getState>) => {
      if (s.status === 'ready' && s.doc === store.getState().doc) host.syncProjections(s.sketches);
    };
    sync(model.getState());
    return model.subscribe((s, previous) => {
      if (s.doc !== previous.doc || s.sketches !== previous.sketches) sync(s);
    });
  }, [host, model, store]);

  // `run` changes every render; commands reach the latest one through a ref.
  const runRef = useRef<(tool: ToolId) => void>(() => {});
  // Feature dialogs (P2-05): one controller; while a dialog is open, picks go to its fields.
  const { controller: dialog, open: dialogOpen } = useFeatureDialogs({
    store,
    session,
    model,
    viewport,
    dialogs,
    kernel,
    notify,
  });
  // The model's bodies with their names (ADR-0030): new bodies get stored names as soon as a
  // recompute shows them, amended into the undo step that made them.
  useEffect(() => followBodyNames(store, model), [store, model]);
  const bodyList = useMemo(() => bodyEntries(doc, bodies), [doc, bodies]);
  const bodyMeta = useMemo(() => bodyMetaOf(bodyList), [bodyList]);
  const bodyListRef = useRef(bodyList);
  bodyListRef.current = bodyList;
  const bodyActions = useMemo(
    () => ({
      ...createBodyActions({ store, session }, () => bodyListRef.current, notify),
      // A body's menu exports it (P2-12).
      exportBodies: (ids: readonly BodyId[]) => setModelExport({ bodies: ids }),
    }),
    [store, session, notify],
  );
  const selectedBodyIds = useMemo(
    () => selection.filter((item) => item.kind === 'body').map((item) => item.id as BodyId),
    [selection],
  );
  // The Project tool (P2-09) picks body edges and faces in the open sketch.
  const project = useProjectTool({
    store,
    session,
    viewport,
    kernel,
    notify,
    active: projecting,
    sketchId: activeSketchId,
  });
  // Redefine Plane (P2-11): Create Sketch's plane pick, for an existing sketch. It shows and
  // picks the bodies before the sketch, which can only lie on what comes before it.
  const [redefining, setRedefining] = useState<FeatureId>();
  useEffect(() => {
    if (activeTool !== CREATE_SKETCH) setRedefining(undefined);
  }, [activeTool]);
  const redefineBase = useBodiesBefore({
    active: picking && redefining !== undefined,
    featureId: redefining,
    store,
    kernel,
  });
  // Editing a feature shows and picks the bodies before it (the preview's base), and so
  // does the Project tool in a sketch that later features build on.
  const shownBodies = project.bodies ?? redefineBase ?? dialogBodies(dialogOpen, bodies);
  const dialogItems = useDialogItems(dialogOpen, shownBodies);
  const preview = useMemo(() => viewPreview(dialogOpen), [dialogOpen]);
  const ready = useMemo(
    () =>
      new Set(
        dialogs
          .list()
          .map((spec) => spec.command)
          .filter((c): c is ToolId => typeof c === 'string'),
      ),
    [dialogs],
  );
  const dialogCommands = useMemo(
    () =>
      dialogs.list().flatMap((spec) => {
        const c = spec.command;
        if (typeof c === 'string') return [];
        return [
          {
            id: c.id,
            label: c.label,
            group: c.group,
            keywords: `${c.group} ${c.hint}`,
            icon: <ToolIcon name={c.icon} category={c.category} size={16} />,
            keys: keysFor(c.id),
            run: () => runRef.current(c.id as ToolId),
          },
        ];
      }),
    [dialogs],
  );
  // A dialog stops a nav tool, like any command.
  useEffect(() => {
    if (dialogOpen) viewport.getState().setTool(undefined);
  }, [dialogOpen, viewport]);
  // Feature dialogs belong to the model: opening a sketch (from the timeline, say) ends one.
  useEffect(() => {
    if (mode === 'sketch') dialog?.cancel();
  }, [mode, dialog]);

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

  // Commands (P1-14): the shortcuts, the Ctrl+K palette and the S toolbox run the same list.
  const construction = useHostState(host, (s) => s.construction);
  const [search, setSearch] = useState<SearchOpen>();
  const [recent, setRecent] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>(() =>
    platform.preferences.get<string[]>(PINS_KEY, DEFAULT_PINS),
  );
  const togglePin = (id: string) =>
    setPinned((pins) => {
      const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
      platform.preferences.set(PINS_KEY, next);
      return next;
    });
  // The toolbox opens at the pointer: the last place it was seen over the page.
  const pointer = useRef<{ x: number; y: number }>(undefined);
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  const commands = useMemo(
    () =>
      buildCommands({
        mode,
        runTool: (tool) => {
          // A key or a search result starts a sketch tool; only the toolbar toggles it off.
          if (isSketchTool(tool) && host) host.start(tool);
          else runRef.current(tool);
        },
        notify,
        // Undo and redo end an open dialog first (its draft isn't in the history).
        undo: () => {
          dialog?.cancel();
          store.getState().undo();
        },
        redo: () => {
          dialog?.cancel();
          store.getState().redo();
        },
        ...(mode === 'sketch' && !drawing && { remove }),
        // Delete with bodies selected in the model removes them (a Remove feature, P2-08).
        ...(mode === 'model' &&
          !dialogOpen &&
          selectedBodyIds.length > 0 && { remove: () => bodyActions.remove(selectedBodyIds) }),
        ...(mode === 'sketch' &&
          host && {
            construction: { on: construction ?? false, toggle: () => host.toggleConstruction() },
          }),
        ...(mode === 'sketch' && { lookAtSketch: () => lookAtSketch(stores) }),
        viewport,
        browser: { collapsed: browser.collapsed, toggle: browser.toggle },
        timeline: { collapsed: timeline.collapsed, toggle: timeline.toggle },
        file,
        theme: { choice, set: setChoice },
        ready,
        dialogCommands,
      }),
    [
      mode,
      host,
      notify,
      store,
      dialog,
      ready,
      dialogCommands,
      drawing,
      remove,
      dialogOpen,
      selectedBodyIds,
      bodyActions,
      construction,
      stores,
      viewport,
      browser.collapsed,
      browser.toggle,
      timeline.collapsed,
      timeline.toggle,
      file,
      choice,
      setChoice,
    ],
  );
  const openToolbox = useMemo(
    () => () =>
      setSearch({
        kind: 'toolbox',
        at: pointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 },
      }),
    [],
  );
  const openSearch = (kind: 'palette' | 'toolbox') =>
    kind === 'palette' ? setSearch({ kind: 'palette' }) : openToolbox();
  const runCommand = (command: AppCommand) => {
    setSearch(undefined);
    setRecent((r) => [command.id, ...r.filter((id) => id !== command.id)].slice(0, RECENT));
    command.run();
  };

  const shortcuts = useMemo(
    () => [
      // An open feature dialog: Esc cancels it (a field whose text doesn't evaluate reverts
      // that first and keeps the key), Enter presses OK (fields press it after committing).
      ...(dialogOpen && dialog
        ? [
            {
              keys: 'Escape',
              inFields: true,
              run: () => dialog.cancel(),
            },
            { keys: 'Enter', run: () => dialog.ok() },
          ]
        : []),
      ...commandShortcuts(commands),
      ...keysFor('commandPalette').map((keys) => ({
        keys,
        run: () => setSearch({ kind: 'palette' }),
      })),
      ...keysFor('toolbox').map((keys) => ({ keys, run: openToolbox })),
      ...(picking ? [{ keys: 'Escape', run: () => cancelCreateSketch(stores) }] : []),
      ...(projecting ? [{ keys: 'Escape', run: () => session.getState().setTool(undefined) }] : []),
      ...(drawing && host
        ? [
            { keys: 'Escape', run: () => host.escape() },
            { keys: 'Enter', run: () => host.enter() },
          ]
        : []),
      // In the model, Esc stops a nav tool (as the viewport's own Esc does), or else clears
      // the selection (P2-03).
      ...(mode === 'model' && !picking
        ? [
            {
              keys: 'Escape',
              run: () => {
                if (viewport.getState().tool) viewport.getState().setTool(undefined);
                else session.getState().clearSelection();
              },
            },
          ]
        : []),
      // Esc puts dragged geometry back, or else clears the selection (P1-09).
      ...(mode === 'sketch' && !drawing
        ? [
            {
              keys: 'Escape',
              run: () => {
                if (!host?.cancelMove()) session.getState().clearSelection();
              },
            },
          ]
        : []),
    ],
    [
      commands,
      openToolbox,
      session,
      stores,
      picking,
      projecting,
      mode,
      drawing,
      host,
      viewport,
      dialogOpen,
      dialog,
    ],
  );
  useShortcuts(shortcuts);

  const run = (tool: ToolId) => {
    // A feature dialog's command opens it (P2-05); another tool (not Parameters) ends it.
    const spec = specForCommand(dialogs, tool);
    if (spec) {
      if (mode === 'model') {
        if (picking) cancelCreateSketch(stores);
        dialog?.start(spec.type);
      }
      return;
    }
    if (tool !== 'parameters') dialog?.cancel();
    if (tool === 'parameters') setParametersOpen(true);
    else if (tool === 'sketch') {
      if (picking) cancelCreateSketch(stores);
      else {
        // A flat face selected in the model takes the sketch at once (P2-09).
        const selected = session.getState().selection;
        const face = selected.length === 1 ? readTopology(selected[0]) : undefined;
        if (mode === 'model' && face?.kind === 'face' && selected[0]) {
          void sketchOnFace(selected[0], true);
        } else startCreateSketch(stores);
      }
    } else if (tool === PROJECT_TOOL) {
      if (mode !== 'sketch') return;
      if (projecting) session.getState().setTool(undefined);
      else {
        host?.stop();
        session.getState().setTool(PROJECT_TOOL);
      }
    } else if (tool === 'finishSketch') finishSketch(stores);
    else if (tool === 'export') setModelExport({});
    else if (tool === 'exportSketch' && activeSketchId) {
      // Profiles selected in the open sketch are offered first (P1-13).
      featureActions.exportSketch(activeSketchId);
    } else if (isSketchTool(tool) && host) {
      if (activeTool === tool) host.stop();
      else host.start(tool);
    }
  };
  runRef.current = run;
  // The browser's own right-click menu stays out of the app while a project is open.
  useEffect(() => {
    window.addEventListener('contextmenu', keepNativeMenuOut);
    return () => window.removeEventListener('contextmenu', keepNativeMenuOut);
  }, []);

  // One pointer mode at a time: Select, a nav tool (Orbit, Pan, Zoom) or a command. Starting a
  // tool or Create Sketch ends a nav tool; the nav bar's Select stops whatever runs.
  useEffect(() => {
    if (activeTool) viewport.getState().setTool(undefined);
  }, [activeTool, viewport]);
  const stopCommand = () => {
    if (picking) cancelCreateSketch(stores);
    else if (drawing) host?.stop();
    else if (projecting) session.getState().setTool(undefined);
  };

  /**
   * Starts a sketch on a picked or selected face (P2-09) once the kernel has
   * given its persistent reference: a flat face only. With `fallback`, a
   * face that can't take a sketch leaves Create Sketch waiting for a plane.
   */
  const sketchOnFace = async (item: SelectionItem, fallback = false) => {
    const face = readTopology(item);
    if (face?.kind !== 'face') return;
    const target = redefining;
    const ref: GeomRef | undefined = await kernel?.reference(
      face.body,
      'face',
      face.index,
      target !== undefined && redefineBase !== undefined,
    );
    if (ref?.fingerprint?.type === 'plane') {
      if (target) redefineTo(target, ref);
      else createSketchOn(stores, ref);
      return;
    }
    notify(
      'error',
      ref
        ? 'A sketch needs a flat face or a plane: that face is curved.'
        : "Can't sketch on that face yet: the model is still computing.",
    );
    if (fallback) startCreateSketch(stores);
  };
  const sketchOnFaceRef = useRef(sketchOnFace);
  sketchOnFaceRef.current = sketchOnFace;
  /** Puts the sketch being redefined on `plane`: one undo step; a refusal keeps the pick going. */
  const redefineTo = (id: FeatureId, plane: GeomRef) => {
    try {
      store.getState().dispatch(redefineSketchPlane({ id, plane }));
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      notify('error', error.message);
      return;
    }
    cancelCreateSketch(stores);
    setRedefining(undefined);
  };
  // The File menu offers the model's export too (P2-12).
  const fileActions = useMemo(() => ({ ...file, exportModel: () => setModelExport({}) }), [file]);
  const pickPlane = (plane: OriginPlaneId) => {
    if (redefining) redefineTo(redefining, originPlaneRef(plane));
    else createSketchOn(stores, originPlaneRef(plane));
  };
  const pickPlaneRef = useRef(pickPlane);
  pickPlaneRef.current = pickPlane;
  const startRedefine = (id: FeatureId) => {
    dialog?.cancel();
    if (session.getState().activeTool !== CREATE_SKETCH) startCreateSketch(stores);
    setRedefining(id);
  };
  const startRedefineRef = useRef(startRedefine);
  startRedefineRef.current = startRedefine;
  // The timeline's and the browser's feature commands (P1-12), and sketch export (P1-13).
  const featureActions = useMemo(
    () =>
      createFeatureActions(stores, notify, {
        exportSketch: (id) =>
          setExportRequest({
            sketch: id,
            selected: profileIdsIn(session.getState().selection, id),
          }),
        editFeature: (id) => {
          if (picking) cancelCreateSketch(stores);
          return dialog?.edit(id) ?? false;
        },
        hasDialog: (type) => dialogs.get(type) !== undefined,
        fixFeature: (id, issues) => {
          if (picking) cancelCreateSketch(stores);
          return dialog?.edit(id, { fix: issues }) ?? false;
        },
        redefinePlane: (id) => startRedefineRef.current(id),
      }),
    [stores, notify, session, dialog, dialogs, picking],
  );

  // Every active, unsuppressed, shown sketch on a known plane is drawn (the open one even if
  // hidden), in its status colours. Profiles are shaded (P1-11) unless the palette hides them.
  // The pointer on a sketch's chip or browser row highlights it (P1-12).
  const status = useHostState(host, (s) => s.status);
  // An open feature dialog's picks are what the view shows selected (a revolve's axis line,
  // the bodies in the browser).
  const shownSelection = dialogItems ?? selection;
  const sketches = useMemo(() => {
    const out: SketchDrawing[] = [];
    doc.features.forEach((feature, index) => {
      if (index >= doc.timelineMarker || feature.suppressed) return;
      const active = feature.id === activeSketchId;
      if (!active && !isFeatureVisible(feature)) return;
      const sketch = readSketch(feature);
      // Origin planes have fixed frames; a face's follows the face (P2-09).
      const frame = sketch && sketchFrame(feature.id, sketch.plane, sketchReports);
      if (sketch && frame) {
        out.push({
          id: feature.id,
          name: feature.name,
          frame,
          data: sketch.data,
          active,
          highlight: hover?.kind === 'feature' && hover.id === feature.id,
          status: active ? status?.entities : undefined,
          // Curves picked in model mode (P2-03).
          ...(!active && {
            hoverEntity: sketchEntityIdsIn([hover], feature.id)[0],
            selectedEntities: sketchEntityIdsIn(shownSelection, feature.id),
          }),
          ...(showProfiles && {
            profiles: sketchProfiles(sketch.data),
            hoverProfile: profileIdsIn([hover], feature.id)[0],
            selectedProfiles: profileIdsIn(shownSelection, feature.id),
          }),
        });
      }
    });
    return out;
  }, [
    doc.features,
    doc.timelineMarker,
    activeSketchId,
    status,
    showProfiles,
    hover,
    shownSelection,
    sketchReports,
  ]);
  const activeSketch = doc.features.find((f) => f.id === activeSketchId);
  const sketchPlane = sketches.find((s) => s.active)?.frame;
  // In the model, with no command running, the view picks bodies, sketch curves and
  // profiles (P2-03). Sketch mode keeps its own picking (the tool host).
  const sessionSelect = useModelSelection(
    session,
    bodies,
    mode === 'model' && !picking && !dialogOpen,
  );
  const modelSelect =
    dialogOpen && mode === 'model'
      ? dialogPlanePick(dialog, dialogOpen)
        ? undefined
        : dialog?.select
      : projecting
        ? project.select
        : sessionSelect;
  // Body rows show the bodies in the selection (the dialog's picks while one is open).
  const selectedBodies = useMemo(
    () => new Set(shownSelection.filter((i) => i.kind === 'body').map((i) => i.id)),
    [shownSelection],
  );

  // A drawing tool takes the pointer; with none running, the host selects and drags geometry
  // (P1-09). Until the host has loaded, a click in the view clears the selection.
  const sketchInput = useMemo<SketchInput | undefined>(() => {
    // The Project tool picks in 3D instead (P2-09).
    if (!sketchPlane || projecting) return undefined;
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
  }, [drawing, host, sketchPlane, activeTool, session, projecting]);

  // A feature dialog's Plane field (P2-10) picks origin planes and flat faces the same way.
  const dialogPlanes = useMemo(
    () =>
      mode === 'model' && !picking
        ? dialogPlanePicker(dialog, dialogOpen, session, hover)
        : undefined,
    [mode, picking, dialog, dialogOpen, session, hover],
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
            onPick: (plane) => pickPlaneRef.current(plane),
            // Flat faces take a sketch too (P2-09), once the kernel can name them.
            ...(kernel && {
              faces: {
                onHover: (item: SelectionItem | undefined) => {
                  const current = session.getState().hover;
                  if (item) session.getState().setHover(item);
                  else if (current?.kind === 'face') session.getState().setHover(undefined);
                },
                onPick: (item: SelectionItem) => {
                  void sketchOnFaceRef.current(item);
                },
              },
            }),
          }
        : dialogPlanes,
    [picking, hover, session, kernel, dialogPlanes],
  );

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-bg text-ink">
      <AppBar
        store={store}
        autosave={autosave}
        file={fileActions}
        theme={choice}
        onThemeChange={setChoice}
        onSearch={openSearch}
      />
      <Toolbar
        mode={mode}
        activeTool={
          picking
            ? 'sketch'
            : drawing || projecting
              ? (activeTool as ToolId)
              : dialogOpen && typeof dialogOpen.spec.command === 'string'
                ? dialogOpen.spec.command
                : undefined
        }
        onRun={run}
        ready={ready}
      />
      {/* The view fills the area; the browser floats over its left edge (glass, like the nav
          bar), so showing, hiding or resizing it never resizes the view. Overlays anchored to
          the view's left or centre keep clear of it through --x-browser-inset. */}
      <main
        className="relative flex min-h-0"
        style={
          {
            '--x-browser-inset': browser.collapsed ? '0px' : `${browser.size}px`,
          } as CSSProperties
        }
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex">
          <BrowserPanel
            store={store}
            viewport={viewport}
            activeSketchId={activeSketchId}
            actions={featureActions}
            bodies={bodyList}
            bodyActions={bodyActions}
            selectedBodies={selectedBodies}
            onPickBody={
              modelSelect
                ? (id, toggle) => modelSelect.onClick({ kind: 'body', id }, toggle)
                : undefined
            }
            onHoverBody={(id) => modelSelect?.onHover(id ? { kind: 'body', id } : undefined)}
            width={browser.size}
            collapsed={browser.collapsed}
            animate={browser.animate}
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
        </div>
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
            bodies={shownBodies}
            meta={bodyMeta}
            sketches={sketches}
            sketchPlane={sketchPlane}
            planePicker={planePicker}
            sketchInput={sketchInput}
            commandRunning={drawing || picking || projecting}
            onStopCommand={stopCommand}
            hover={hover}
            selection={dialogItems ?? selection}
            modelSelect={modelSelect}
            preview={preview}
          >
            {dialogOpen && dialog && (
              <DialogOverlay
                controller={dialog}
                viewport={viewport}
                settings={doc.settings}
                bodies={shownBodies}
              />
            )}
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
            {...(redefining && {
              title: 'Redefine Plane',
              hint: `Pick a plane or a flat face for ${doc.features.find((f) => f.id === redefining)?.name ?? 'the sketch'}, in the view or here.`,
            })}
            onPick={pickPlane}
            onCancel={() => cancelCreateSketch(stores)}
          />
        )}
        {dialog && <FeatureDialog controller={dialog} settings={doc.settings} />}
        {mode === 'sketch' && activeSketch && (
          <PanelColumn>
            <SketchPalette
              name={activeSketch.name}
              viewport={viewport}
              host={host}
              onLookAt={() => lookAtSketch(stores)}
              onFinish={() => finishSketch(stores)}
            />
            {toasts && <Toasts place="column" {...toasts} />}
          </PanelColumn>
        )}
        {toasts && !(mode === 'sketch' && activeSketch) && <Toasts place="view" {...toasts} />}
      </main>
      <Timeline
        store={store}
        collapsed={timeline.collapsed}
        onToggle={timeline.toggle}
        activeSketch={activeSketch?.name}
        actions={featureActions}
        viewport={viewport}
        model={model}
        session={session}
        editing={dialogOpen?.mode === 'edit' ? dialogOpen.id : undefined}
      />
      <OverConstrainedDialog host={host} />
      <ParametersDialog
        store={store}
        apply={apply}
        open={parametersOpen}
        onOpenChange={setParametersOpen}
      />
      <CommandSearch
        open={search}
        commands={commands}
        recent={recent}
        pinned={pinned}
        onTogglePin={togglePin}
        onRun={runCommand}
        onClose={() => setSearch(undefined)}
      />
      <ExportModelDialog
        store={store}
        session={session}
        model={model}
        bodies={bodyList}
        kernel={kernel}
        request={modelExport}
        files={platform.files}
        preferences={platform.preferences}
        notify={notify}
        onClose={() => setModelExport(undefined)}
      />
      <ExportSketchDialog
        store={store}
        request={exportRequest}
        files={platform.files}
        onClose={() => setExportRequest(undefined)}
      />
    </div>
  );
}
