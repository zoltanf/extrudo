import {
  type BodyId,
  CANVAS_TYPE,
  type Command,
  CommandError,
  type DocumentStore,
  type Feature,
  type FeatureId,
  formatQuantity,
  type GeomRef,
  IMPORT_TYPE,
  isFeatureVisible,
  LENGTH,
  type ModelStore,
  pluginFileOf,
  readSketch,
  redefineSketchPlane,
  type SelectionItem,
  type SessionStore,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { keysFor } from '../commands/keymap';
import { isRepeatable } from '../commands/marking';
import { isEditable, useShortcuts } from '../commands/shortcuts';
import { CustomizerPanel } from '../customizer/CustomizerPanel';
import { CUSTOMIZER_TOOL, useCustomizer } from '../customizer/useCustomizer';
import {
  type IconName,
  type NotificationStore,
  type Toast,
  type ToastOptions,
  Toasts,
  ToolIcon,
  useTheme,
} from '../design-system';
import { ExportModelDialog, type ModelExportRequest } from '../export/ExportModelDialog';
import type { ModelExporter } from '../export/modelExport';
import { calibrationStore, pickCanvasFile } from '../features/canvas';
import { DialogOverlay } from '../features/DialogOverlay';
import { type DialogKernel, dialogBodies, viewPreview } from '../features/dialog';
import { DIALOG_COLUMN, FeatureDialog } from '../features/FeatureDialog';
import { pickImportFile } from '../features/import';
import { pickName } from '../features/pickName';
import { dialogPlanePick, dialogPlanePicker } from '../features/planePicker';
import { PRESS_PULL, PRESS_PULL_PROMPT, pressPullTarget } from '../features/pressPull';
import { cornersStore } from '../features/primitiveCorners';
import { type FeatureDialogs, featureDialogs, specForCommand } from '../features/registry';
import { useDialogItems, useFeatureDialogs } from '../features/useFeatureDialogs';
import { MacroDialog } from '../macro/MacroDialog';
import {
  createMacroStore,
  designCode,
  endedByUndo,
  macroCode,
  type Recorded,
  scriptFileName,
} from '../macro/macro';
import { analyticItem } from '../measure/analytic';
import { sizeText } from '../measure/format';
import {
  createMeasureSelect,
  MEASURE_TOOL,
  type MeasureKernel,
  measureState,
  useInspection,
} from '../measure/inspection';
import { MeasureOverlay } from '../measure/MeasureOverlay';
import { MeasurePanel } from '../measure/MeasurePanel';
import { TutorialCard } from '../onboarding/TutorialCard';
import { useTutorial } from '../onboarding/useTutorial';
import { ViewportHint } from '../onboarding/ViewportHint';
import { ParametersDialog } from '../parameters/ParametersDialog';
import type { Platform } from '../platform';
import {
  pluginFeatureEntries,
  preparePluginAttachment,
  specForPluginFeature,
} from '../plugins/featureSpecs';
import { PluginsDialog } from '../plugins/PluginsDialog';
import { createPluginsStore, type DesignPlugin, designPlugins } from '../plugins/plugins';
import {
  type PluginCommand,
  type PluginCommandKernel,
  pluginCommands,
  runPluginCommand,
} from '../plugins/runCommand';
import { updatePluginInDesign } from '../plugins/update';
import { useDesignPluginFiles } from '../plugins/useDesignPluginFiles';
import { OverhangPanel } from '../print/OverhangPanel';
import { PrintInfoPanel } from '../print/PrintInfoPanel';
import { ThicknessOverlay } from '../print/ThicknessOverlay';
import { TolerancePanel } from '../print/TolerancePanel';
import { OVERHANG_TOOL, PRINT_INFO_TOOL, useOverhang, usePrintInfo } from '../print/usePrintAids';
import { THICKNESS_TOOL, useThickness } from '../print/useThickness';
import { TOLERANCE_TOOL, useTolerance } from '../print/useTolerance';
import { WallThicknessPanel } from '../print/WallThicknessPanel';
import { type Autosaver, saveEverything } from '../project/autosave';
import { setRestoreGuard } from '../project/restoreGuard';
import { VersionsDialog } from '../project/VersionsDialog';
import type { VersionContext } from '../project/versions';
import { navigate, projectHref } from '../routes';
import { SectionOverlay } from '../section/SectionOverlay';
import { SectionPanel } from '../section/SectionPanel';
import { planeName, SECTION_TOOL, useSection } from '../section/useSection';
import { readTopology, selectionRefs, sketchEntityIdsIn } from '../selection/items';
import { useModelSelection } from '../selection/useModelSelection';
import type { FontPicker } from '../sketch/addFont';
import { useBodiesBefore } from '../sketch/baseBodies';
import { type ExportRequest, ExportSketchDialog } from '../sketch/ExportSketchDialog';
import { attachmentBytes, fontsStore } from '../sketch/fonts';
import { sketchFrame } from '../sketch/frame';
import { useHostState } from '../sketch/hostState';
import { importDrawingStore } from '../sketch/importDraft';
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
  ImportDrawingPanel,
  OverConstrainedDialog,
  PanelColumn,
  PlanePrompt,
  ProjectPanel,
  SelectionPanel,
  SketchPalette,
  TextPanel,
} from '../sketch/panels';
import { pickDrawing } from '../sketch/pickDrawing';
import { profileIdsIn, sketchProfiles } from '../sketch/profiles';
import { INTERSECT_TOOL, isProjectTool, PROJECT_TOOL, useProjectTool } from '../sketch/project';
import { deleteSelection } from '../sketch/selection';
import { textDraftStore } from '../sketch/textDraft';
import type { ToolHost } from '../sketch/tools/host';
import { isPickingTool, isSketchTool } from '../sketch/tools/ids';
import { IMPORT_DRAWING_TOOL } from '../sketch/tools/importDrawing';
import { canvasDrawings } from '../viewport/canvasGeometry';
import { forgetCanvasImages } from '../viewport/canvasImages';
import type { ConstructionDrawing } from '../viewport/constructionGeometry';
import { ghostsOf } from '../viewport/ghostGeometry';
import { ModelProgress, useRecomputeFinished } from '../viewport/ModelProgress';
import type { SketchDrawing } from '../viewport/sketchGeometry';
import type { ViewportStore } from '../viewport/store';
import type { PlanePicker, SketchInput } from '../viewport/Viewport';
import { ViewportBoundary } from '../viewport/ViewportBoundary';
import { AppBar, type FileActions } from './AppBar';
import { BROWSER_ID, BrowserPanel } from './BrowserPanel';
import {
  bodyEntries,
  bodyMetaOf,
  createBodyActions,
  followBodyNames,
  pendingBodyEntries,
} from './bodies';
import { CommandSearch, type SearchOpen } from './CommandSearch';
import { CustomizeMarkingMenu } from './CustomizeMarkingMenu';
import {
  type AppCommand,
  buildCommands,
  commandShortcuts,
  DRAWING_IMPORT_UNAVAILABLE,
} from './commands';
import type { DocsPage } from './docsLinks';
import { docsPath } from './docsLinks';
import { createFeatureActions } from './featureActions';
import { createGroupActions } from './groupActions';
import { menuModel, QUIT_ID, SAVE_AS_ID } from './menuModel';
import { Splitter, usePanel } from './panels';
import { watchRecomputeErrors } from './recomputeErrors';
import { Timeline } from './Timeline';
import { Toolbar, ToolbarTabs, useToolbarTab } from './Toolbar';
import {
  createTimelineSelectionStore,
  hoveredFeatureIds,
  openGroupAtMarker,
  type TimelineSelectionStore,
} from './timelineGroups';
import { FILE_COMMANDS, isFileCommand, TOOLS, type ToolId } from './tools';
import { useMarkingSlots, useMarkingStyle, useViewMenu } from './viewMenu';

/** The toolbox's pins until the user changes them (P1-14). */
const DEFAULT_PINS = ['sketch', 'line', 'rectangle', 'circle', 'dimension', 'trim', 'parameters'];
const PINS_KEY = 'toolbox.pins';
const RECENT = 8;
/** How long the selection stays still before the status bar asks for its size (P3-17), ms. */
const SIZE_DELAY_MS = 150;
const TOPOLOGY_NOUNS = { face: 'Face', edge: 'Edge', vertex: 'Vertex' } as const;

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
  notify?(tone: 'info' | 'success' | 'error', text: string, options?: ToastOptions): void;
  /**
   * The project page's toasts (`useToasts`), drawn in the view's bottom-right
   * corner, or at the foot of the sketch palette while a sketch is open.
   */
  toasts?: {
    toasts: Toast[];
    onDismiss(id: number): void;
    /** The session's notification history (P3-16): a button below the toasts opens it. */
    history?: NotificationStore;
  };
  /** Feature dialogs (P2-05): the app's registry unless a debug page brings its own. */
  dialogs?: FeatureDialogs;
  /** The project's kernel (its `Recomputer`): dialog previews, references, export, measuring. */
  /**
   * The live body IDs of the last finished recompute, read from the model
   * cache (ADR-0078): listed as pending rows until a recompute finishes.
   */
  pendingBodies?: readonly string[];
  kernel?: DialogKernel & ModelExporter & MeasureKernel & Partial<PluginCommandKernel>;
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
/** Repeat last, as the dialog lists it: the name of the tool it happens to repeat doesn't belong there. */
function relabelRepeat(commands: AppCommand[]): AppCommand[] {
  return commands.map((c) => (c.id === 'repeatLast' ? { ...c, label: 'Repeat last' } : c));
}

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
  pendingBodies,
  toasts,
  dialogs = APP_DIALOGS,
  kernel,
}: AppShellProps) {
  const { choice, setChoice } = useTheme(platform.preferences);
  const browser = usePanel(platform.preferences, { key: 'browser', size: 248, min: 180, max: 480 });
  // The browser floats over the view's left edge: fitting frames the part it leaves open.
  const browserCover = browser.collapsed ? 0 : browser.size;
  useEffect(() => viewport.getState().setCover(browserCover), [viewport, browserCover]);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [exportRequest, setExportRequest] = useState<ExportRequest>();
  const [modelExport, setModelExport] = useState<ModelExportRequest>();
  const [versionsOpen, setVersionsOpen] = useState(false);
  // The person's installed plugins (P6-03 slice 2, ADR-0077 §4): session state over the
  // platform's store, read once here and again after every change the dialog makes.
  const plugins = useMemo(() => createPluginsStore(platform.plugins), [platform]);
  useEffect(() => void plugins.getState().refresh(), [plugins]);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const installedPlugins = useStore(plugins, (s) => s.installed);
  // The custom features of the enabled plugins (ADR-0077 §6): a second, dynamic registry of
  // dialogs beside `dialogs`, and the plugin files the design carries (a stored feature's
  // dialog is generated from the design's own copy).
  const pluginFeatures = useMemo(() => pluginFeatureEntries(installedPlugins), [installedPlugins]);
  const designPluginFiles = useDesignPluginFiles(store);
  const pluginHint = useCallback(
    (feature: Feature) => {
      const id = pluginFileOf(feature);
      const manifest = id && designPluginFiles.files.get(id)?.manifest;
      return manifest ? `${manifest.name} ${manifest.version}` : undefined;
    },
    [designPluginFiles.files],
  );
  // The Create menu's "Plugins" items: one per custom feature (run like the Ctrl+K command).
  const pluginItems = useMemo(
    () =>
      pluginFeatures.map(({ command, spec, plugin }) => ({
        id: command,
        label: spec.label,
        icon: spec.icon as IconName,
        hint: `${plugin.name} ${plugin.version}`,
      })),
    [pluginFeatures],
  );
  const pluginSpecFor = useCallback(
    (feature: Feature) => specForPluginFeature(feature, designPluginFiles.files),
    [designPluginFiles.files],
  );
  // A plugin command (ADR-0077 §5) runs in the kernel worker on the model selection; what it
  // made goes in at the marker as one undo step. A ref, so the command list stays stable.
  const runPluginRef = useRef<(command: PluginCommand) => void>(() => {});
  const pluginEntries = useMemo(
    () =>
      kernel?.runPluginCommand
        ? pluginCommands(installedPlugins).map((command) => ({
            id: command.id,
            label: command.label,
            group: command.group,
            ...(command.hint !== undefined && { hint: command.hint }),
            run: () => runPluginRef.current(command),
          }))
        : [],
    [installedPlugins, kernel],
  );
  // "Update to <version>" (slice 3): the installed file replaces the design's older copy.
  const updatePlugin = useCallback(
    async (entry: DesignPlugin) => {
      const installed = plugins
        .getState()
        .installed?.find((p) => p.plugin.id === entry.manifest.id);
      if (!installed) return `${entry.manifest.name} is not installed.`;
      const outcome = await updatePluginInDesign({
        plugin: installed.plugin,
        bytes: await platform.plugins.bytes(installed.plugin.id),
        store,
        projects: platform.projects,
      }).catch((error: unknown) => ({
        message: error instanceof Error ? error.message : String(error),
      }));
      return outcome.message;
    },
    [plugins, platform, store],
  );
  const inDesign = useCallback(
    () =>
      designPlugins(
        store.getState().doc,
        (plugins.getState().installed ?? []).map((entry) => entry.plugin),
        attachmentBytes,
      ),
    [store, plugins],
  );
  // Macro recording (P5-05, ADR-0073 §4): session state, and what Stop wrote for its dialog.
  const macro = useMemo(() => createMacroStore(), []);
  const recording = useStore(macro, (s) => s.recording);
  const [recorded, setRecorded] = useState<Recorded>();
  const versionContext = useMemo<VersionContext>(
    () => ({ store, autosave, projects: platform.projects }),
    [store, autosave, platform],
  );
  // Adding a font to the design from a text's Font select (P4-03b, ADR-0061 §3).
  const fontPicker = useMemo<FontPicker>(
    () => ({ files: platform.files, projects: platform.projects }),
    [platform],
  );
  // The Home tab's file commands (ADR-0079): the model's export too (P2-12), versions
  // (P2-14), an import (P4-06), the script export (P5-05) and plugins (P6-03).
  const fileActions = useMemo(
    () => ({
      ...file,
      exportModel: () => setModelExport({}),
      importModel: () => startImportRef.current(),
      exportScript: () => exportScriptRef.current(),
      saveVersion: () => setVersionsOpen(true),
      versionHistory: () => setVersionsOpen(true),
      plugins: () => setPluginsOpen(true),
    }),
    [file],
  );
  // Text needs its font before it has curves or ink (P4-03): a font that arrives
  // late brings the sketch drawing and its profiles back with it.
  const fontsVersion = useStore(fontsStore, (s) => s.version);
  // The Text tool's panel opens from the tool's own click (P4-03), which
  // touches no store this component reads: subscribe, so it appears.
  const textOpen = useStore(textDraftStore, (s) => s.open);
  // The Import Drawing tool's panel opens from the file it picked (P4-06).
  const importOpen = useStore(importDrawingStore, (s) => s.open);
  const bodies = useStore(model, (s) => s.bodies);
  const recomputeFinished = useRecomputeFinished(model);
  const sketchReports = useStore(model, (s) => s.sketches);
  const constructionReports = useStore(model, (s) => s.construction);
  const canvasReports = useStore(model, (s) => s.canvases);
  const featureStatuses = useStore(model, (s) => s.features);
  const doc = useStore(store, (s) => s.doc);
  const mode = useStore(session, (s) => s.mode);
  // The selected toolbar tab: its tabs are in the top bar, its tools in the row below (ADR-0079).
  const [toolbarTab, setToolbarTab] = useToolbarTab(mode);
  const activeSketchId = useStore(session, (s) => s.activeSketchId);
  const activeTool = useStore(session, (s) => s.activeTool);
  const hover = useStore(session, (s) => s.hover);
  const picking = activeTool === CREATE_SKETCH;
  const drawing = mode === 'sketch' && isSketchTool(activeTool);
  const projecting = mode === 'sketch' && isProjectTool(activeTool);
  const measuring = mode === 'model' && activeTool === MEASURE_TOOL;
  const sectioning = mode === 'model' && activeTool === SECTION_TOOL;
  const printing = mode === 'model' && activeTool === PRINT_INFO_TOOL;
  const tolerancing = mode === 'model' && activeTool === TOLERANCE_TOOL;
  const overhanging = mode === 'model' && activeTool === OVERHANG_TOOL;
  const thickening = mode === 'model' && activeTool === THICKNESS_TOOL;
  const customizing = mode === 'model' && activeTool === CUSTOMIZER_TOOL;
  // The first-run tutorial (P3-12): it reads the design, so it needs no hooks into the tools.
  const tutorial = useTutorial({ store, session, preferences: platform.preferences });
  // A design with nothing in it starts the tour in place; any other opens a new design for it.
  const startTutorial = () => {
    if (doc.features.length === 0 || !file.startTutorial) tutorial.start();
    else file.startTutorial();
  };
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
  const startTutorialRef = useRef<() => void>(() => {});
  /** The File menu's Import, which is the Insert tab's tile (P4-06). */
  const startImportRef = useRef<() => void>(() => {});
  /** The File menu's Export Design as Script (P5-05). */
  const exportScriptRef = useRef<() => void>(() => {});
  /** Canvas's tool, which picks its picture before its dialog opens. */
  const startCanvasRef = useRef<() => void>(() => {});
  // Feature dialogs (P2-05): one controller; while a dialog is open, picks go to its fields.
  const { controller: dialog, open: dialogOpen } = useFeatureDialogs({
    store,
    session,
    model,
    viewport,
    dialogs,
    specFor: pluginSpecFor,
    kernel,
    notify,
  });
  // The model's bodies with their names (ADR-0030): new bodies get stored names as soon as a
  // recompute shows them, amended into the undo step that made them.
  useEffect(() => followBodyNames(store, model), [store, model]);
  const bodyList = useMemo(() => bodyEntries(doc, bodies), [doc, bodies]);
  // Until the first recompute has finished the browser lists the bodies the last one made
  // (the model cache, ADR-0078) as pending rows; everything else sees only computed bodies.
  const recomputed = useRecomputeFinished(model);
  const browserBodies = useMemo(
    () => (recomputed || !pendingBodies ? bodyList : pendingBodyEntries(doc, pendingBodies)),
    [recomputed, pendingBodies, bodyList, doc],
  );
  const bodyMeta = useMemo(() => bodyMetaOf(bodyList), [bodyList]);
  const bodyListRef = useRef(bodyList);
  // Measure and inspect (P2-13): the kernel measures the selected topology, for the status
  // bar's size readout and the Measure panel; sketch entities, axes and planes are measured
  // here (P3-17). Outside Measure the status bar's question waits for a still selection.
  const inspection = useInspection(
    kernel,
    selection,
    bodies,
    mode === 'model' && !dialogOpen,
    measuring ? 0 : SIZE_DELAY_MS,
  );
  const bodyName = useMemo(() => {
    const names = new Map(bodyList.map((b) => [b.id, b.meta.name]));
    return (id: BodyId) => names.get(id);
  }, [bodyList]);
  const measured = useMemo(() => {
    if (mode !== 'model' || dialogOpen)
      return measureState(
        [],
        inspection,
        () => undefined,
        () => '',
      );
    const ctx = { doc, sketches: sketchReports, construction: constructionReports };
    return measureState(
      selection,
      inspection,
      (item) => {
        const measure = analyticItem(item, ctx);
        if (!measure) return undefined;
        return { item: measure, label: pickName(item as GeomRef, { doc }) ?? item.kind };
      },
      (t) => {
        const body = bodyName(t.body) ?? 'Body';
        return t.kind === 'body' ? body : `${TOPOLOGY_NOUNS[t.kind]} ${t.index + 1} · ${body}`;
      },
    );
  }, [mode, dialogOpen, selection, inspection, doc, sketchReports, constructionReports, bodyName]);
  // The sketch slice's plane (P4-12, ADR-0031 §5): the open sketch's frame while
  // sketch mode is active — the palette's Slice cuts the bodies there.
  const slice = useMemo(() => {
    if (mode !== 'sketch' || !activeSketchId) return undefined;
    const feature = doc.features.find((f) => f.id === activeSketchId);
    const sketch = feature ? readSketch(feature) : undefined;
    return feature && sketch
      ? sketchFrame(feature.id, sketch.plane, sketchReports, constructionReports)
      : undefined;
  }, [mode, activeSketchId, doc, sketchReports, constructionReports]);
  // Section analysis (P3-09): a clipping plane over the model, view state kept in the viewport
  // store. The tool's panel and arrow are open while `sectioning`; the section outlasts them.
  const section = useSection({
    session,
    viewport,
    doc,
    bodies,
    construction: constructionReports,
    kernel,
    notify,
    active: sectioning,
    model: mode === 'model',
    slice,
    hover,
  });
  // 3D-print aids (P3-10): weight and filament estimates, and the overhang shading (view state
  // in the viewport store, like the section).
  const printInfo = usePrintInfo({
    kernel,
    preferences: platform.preferences,
    doc,
    selection,
    bodyList,
    meshes: bodies,
    active: printing,
  });
  const sectionPlane = (index: number) => {
    const plane = section.rows[index]?.state.plane;
    return plane
      ? planeName(plane, {
          construction: (id) => doc.features.find((f) => f.id === id)?.name,
          faceBody: (face) => {
            const found = (Object.entries(bodies) as [BodyId, BodyMesh][]).find(([, mesh]) =>
              mesh.faceIds?.includes(face),
            );
            return found && bodyName(found[0]);
          },
        })
      : 'Plane';
  };
  const sectionOn = section.box ? section.box.state.on : section.rows.some((r) => r.state.on);
  const sectionEntry =
    section.rows.length > 0 || section.box
      ? {
          label: section.box
            ? 'Section · Box'
            : section.rows.length > 1
              ? `Section · ${section.rows.length} planes`
              : `Section · ${sectionPlane(0)}`,
          on: sectionOn,
          active: sectioning,
          onToggle: () => section.setAllOn(!sectionOn),
          onEdit: () => openSection(),
          onRemove: section.removeAll,
        }
      : undefined;
  bodyListRef.current = browserBodies;
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
  // The Project tool (P2-09) picks body edges, faces, vertices and bodies in the open sketch;
  // Intersect (P4-12) faces and bodies. "Keep linked" off makes the next picks an include.
  const [keepLinked, setKeepLinked] = useState(true);
  const project = useProjectTool({
    store,
    session,
    viewport,
    kernel,
    notify,
    tool: projecting && isProjectTool(activeTool) ? activeTool : undefined,
    sketchId: activeSketchId,
    linked: keepLinked,
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
  const overhang = useOverhang({
    viewport,
    doc,
    bodies: shownBodies,
    meta: bodyMeta,
    model: mode === 'model',
    session,
    kernel,
    notify,
  });
  // The wall-thickness check (P5-06): view state like the overhang's, measured on the display
  // meshes with the picking BVHs (no kernel call).
  const thickness = useThickness({
    viewport,
    doc,
    bodies: shownBodies,
    meta: bodyMeta,
    model: mode === 'model',
    preferences: platform.preferences,
  });
  const dialogItems = useDialogItems(dialogOpen, shownBodies);
  const preview = useMemo(() => viewPreview(dialogOpen), [dialogOpen]);
  const canSlicer = platform.openInSlicer !== undefined;
  const ready = useMemo(() => {
    const tools = new Set<string>(
      dialogs
        .list()
        .map((spec) => spec.command)
        .filter((c): c is ToolId => typeof c === 'string'),
    );
    // Send to Slicer (P6-02) is ready where the platform can launch one.
    if (canSlicer) tools.add('slicer');
    return tools;
  }, [dialogs, canSlicer]);
  const dialogCommands = useMemo(
    () =>
      [...dialogs.list(), ...pluginFeatures.map((entry) => entry.spec)].flatMap((spec) => {
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
    [dialogs, pluginFeatures],
  );
  // A dialog stops a nav tool, like any command.
  useEffect(() => {
    if (dialogOpen) viewport.getState().setTool(undefined);
  }, [dialogOpen, viewport]);
  // Feature dialogs belong to the model: opening a sketch (from the timeline, say) ends one.
  useEffect(() => {
    if (mode === 'sketch') dialog?.cancel();
  }, [mode, dialog]);

  // A document change can make a notification's action stale (or valid again): an open
  // history panel asks again (P3-17, ADR-0041).
  const history = toasts?.history;
  useEffect(() => {
    if (!history) return;
    return store.subscribe((s, prev) => {
      if (s.doc !== prev.doc) history.getState().recheck();
    });
  }, [store, history]);

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
  // The Customizer panel (P4-07): the exposed parameters and the configurations.
  // Every write goes through the same `apply`, so a slider or a configuration
  // re-solves the sketches that use the parameter in its own undo step.
  const customizer = useCustomizer({ store, apply });
  // The Tolerance panel (P4-08): its writes are parameter writes, so they go through the same
  // `apply` (ADR-0059).
  const tolerance = useTolerance({ doc, apply });

  // Commands (P1-14): the shortcuts, the Ctrl+K palette and the S toolbox run the same list.
  const construction = useHostState(host, (s) => s.construction);
  const [search, setSearch] = useState<SearchOpen>();
  const [recent, setRecent] = useState<string[]>([]);
  // Repeat last (P3-11): the last tool run through the commands or the toolbar.
  const [lastTool, setLastTool] = useState<string>();
  const markingStyle = useMarkingStyle(platform.preferences);
  const markingSlots = useMarkingSlots(platform.preferences);
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
  // Replacing the whole document is one undo step of its own (ADR-0036, and a
  // linked folder's "Load from disk", P4-09), so whatever holds a transaction
  // open ends first. The linked folder's toast button is clicked from the
  // notification store, outside this tree, so the step is registered there too.
  const endTransaction = useCallback(() => {
    dialog?.cancel();
    if (session.getState().activeTool === CREATE_SKETCH) cancelCreateSketch(stores);
    if (session.getState().mode === 'sketch') finishSketch(stores);
  }, [dialog, session, stores]);
  useEffect(() => setRestoreGuard(endTransaction), [endTransaction]);
  // Undoing past where the recording started ends it (P5-05): there is nothing left to record.
  useEffect(() => {
    if (endedByUndo(macro.getState().recording, doc)) {
      macro.getState().stop();
      notify('info', 'Macro recording ended: you undid past where it started.');
    }
  }, [doc, macro, notify]);
  // Tiles left out: Record or Stop (one at a time), and a Home tab file command the page
  // doesn't offer here (Save to Linked Folder with no folder; ADR-0079).
  const macroHidden = useMemo<ReadonlySet<string>>(
    () =>
      new Set([
        recording ? 'recordMacro' : 'stopMacro',
        ...Object.entries(FILE_COMMANDS)
          .filter(([, action]) => !fileActions[action])
          .map(([id]) => id),
      ]),
    [recording, fileActions],
  );
  const [markingDialog, setMarkingDialog] = useState(false);
  // `listing` builds a mode's commands for the Customize Marking Menu dialog: what the mode
  // offers whatever is selected now (Delete, Repeat last and the construction toggle included).
  const commandBuilder = useMemo(
    () => (m: 'model' | 'sketch', listing: boolean) =>
      buildCommands({
        mode: m,
        runTool: (tool) => {
          if (isRepeatable(tool)) setLastTool(tool);
          // A key or a search result starts a sketch tool; only the toolbar toggles it off.
          // The drawing import picks its file before it has a panel (P4-06), so it
          // goes through `run` like the toolbar's tile does.
          if (tool !== IMPORT_DRAWING_TOOL && isSketchTool(tool) && host) host.start(tool);
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
        ...(listing ? { remove: () => {} } : m === 'sketch' && !drawing && { remove }),
        // Delete with bodies selected in the model removes them (a Remove feature, P2-08).
        ...(!listing &&
          m === 'model' &&
          !dialogOpen &&
          selectedBodyIds.length > 0 && { remove: () => bodyActions.remove(selectedBodyIds) }),
        ...(m === 'sketch' &&
          (listing || host) && {
            construction:
              !listing && host
                ? { on: construction ?? false, toggle: () => host.toggleConstruction() }
                : { on: false, toggle: () => {} },
          }),
        ...(m === 'sketch' && { lookAtSketch: () => lookAtSketch(stores) }),
        viewport,
        browser: { collapsed: browser.collapsed, toggle: browser.toggle },
        file: fileActions,
        theme: { choice, set: setChoice },
        ...(listing
          ? { repeat: { id: m === 'model' ? 'extrude' : 'line' } }
          : lastTool && { repeat: { id: lastTool } }),
        markingMenu: {
          radial: markingStyle.radial,
          toggle: markingStyle.toggle,
          customize: () => setMarkingDialog(true),
        },
        ready,
        dialogCommands,
        plugins: pluginEntries,
        ...(toasts?.history && {
          notifications: { open: () => toasts.history?.getState().setOpen(true) },
        }),
        tutorial: { start: () => startTutorialRef.current() },
        docs: { open: (page: DocsPage) => platform.openDocs(docsPath(page)) },
        macro: { recording: recording !== undefined },
      }),
    [
      host,
      notify,
      store,
      recording,
      dialog,
      ready,
      dialogCommands,
      pluginEntries,
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
      fileActions,
      choice,
      setChoice,
      toasts?.history,
      lastTool,
      markingStyle.radial,
      markingStyle.toggle,
      platform,
    ],
  );
  const commands = useMemo(() => commandBuilder(mode, false), [commandBuilder, mode]);
  const markingCommands = useMemo(
    () =>
      markingDialog
        ? {
            model: relabelRepeat(commandBuilder('model', true)),
            sketch: relabelRepeat(commandBuilder('sketch', true)),
          }
        : { model: [], sketch: [] },
    [markingDialog, commandBuilder],
  );
  const openToolbox = useMemo(
    () => (at?: { x: number; y: number }) =>
      setSearch({
        kind: 'toolbox',
        at: at ?? pointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 },
      }),
    [],
  );
  const openSearch = (kind: 'palette' | 'toolbox', at?: { x: number; y: number }) =>
    kind === 'palette' ? setSearch({ kind: 'palette' }) : openToolbox(at);
  const runCommand = (command: AppCommand) => {
    setSearch(undefined);
    setRecent((r) => [command.id, ...r.filter((id) => id !== command.id)].slice(0, RECENT));
    command.run();
  };

  // The native application menu (P6-01 slice 2, ADR-0075 §2). Desktop only:
  // `platform.menus` is absent in the browser, so nothing here runs on the web.
  // The model is a projection of the same command list the palette uses. `set`
  // on change, but `reset` only when the shell unmounts: a selection change
  // must not flash the bare File menu (finding 5).
  useEffect(() => {
    const menus = platform.menus;
    if (!menus) return;
    const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
    menus.set(menuModel(commands, mode, { mac }));
  }, [platform.menus, commands, mode]);
  useEffect(() => {
    const menus = platform.menus;
    if (!menus) return;
    return () => menus.reset();
  }, [platform.menus]);
  useEffect(() => {
    const menus = platform.menus;
    if (!menus) return;
    // Tell main a project page is listening: with none, File › Quit quits
    // directly and Save As… is disabled (finding 4).
    menus.listening(true);
    const off = menus.onRun((id) => {
      if (id === SAVE_AS_ID) {
        fileActions.saveAs?.();
        return;
      }
      if (id === QUIT_ID) {
        void (async () => {
          // Save before quitting, as the update toast's Reload does (ADR-0054).
          if (!(await saveEverything())) {
            notify('error', "Couldn't save before quitting. Your latest changes are still open.");
            return;
          }
          menus.quit();
        })();
        return;
      }
      const command = commands.find((c) => c.id === id && !c.unavailable);
      command?.run();
    });
    return () => {
      menus.listening(false);
      off();
    };
  }, [platform.menus, commands, fileActions, notify]);

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
      ...keysFor('toolbox').map((keys) => ({ keys, run: () => openToolbox() })),
      ...(picking ? [{ keys: 'Escape', run: () => cancelCreateSketch(stores) }] : []),
      ...(projecting ? [{ keys: 'Escape', run: () => session.getState().setTool(undefined) }] : []),
      ...(drawing && host
        ? [
            { keys: 'Escape', run: () => host.escape() },
            { keys: 'Enter', run: () => host.enter() },
          ]
        : []),
      ...(measuring || sectioning || printing || overhanging || thickening || customizing
        ? [{ keys: 'Escape', run: () => session.getState().setTool(undefined) }]
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
      measuring,
      sectioning,
      printing,
      overhanging,
      thickening,
      customizing,
      mode,
      drawing,
      host,
      viewport,
      dialogOpen,
      dialog,
    ],
  );
  useShortcuts(shortcuts);

  /** Opens the Section Analysis panel on the section as it is (the browser's row). */
  const openSection = () => {
    if (mode !== 'model') return;
    if (picking) cancelCreateSketch(stores);
    dialog?.cancel();
    session.getState().setTool(SECTION_TOOL);
  };
  /** Opens the Overhang Analysis panel on the analysis as it is (the browser's row). */
  const openOverhang = () => {
    if (mode !== 'model') return;
    if (picking) cancelCreateSketch(stores);
    dialog?.cancel();
    session.getState().setTool(OVERHANG_TOOL);
  };
  /** Opens the Wall Thickness panel on the check as it is (the browser's row). */
  const openThickness = () => {
    if (mode !== 'model') return;
    if (picking) cancelCreateSketch(stores);
    dialog?.cancel();
    session.getState().setTool(THICKNESS_TOOL);
  };
  const run = (tool: ToolId) => {
    // The Home tab's file commands (ADR-0079) run what the File menu's items ran.
    if (isFileCommand(tool)) {
      fileActions[FILE_COMMANDS[tool]]?.();
      return;
    }
    // Press Pull (P3-08) runs the tool that fits the selection; Repeat last repeats Press Pull.
    if (tool === PRESS_PULL) {
      if (mode !== 'model') return;
      const target = pressPullTarget(session.getState().selection, doc);
      if (!target) {
        notify('info', PRESS_PULL_PROMPT);
        return;
      }
      run(target);
      setLastTool(PRESS_PULL);
      return;
    }
    // P6-03: a plugin's custom feature (ADR-0077 §6) puts its file with the design first
    // (bytes before the record that names them), then opens its generated dialog.
    const pluginFeature = pluginFeatures.find((entry) => entry.command === tool);
    if (pluginFeature) {
      if (mode !== 'model') return;
      if (picking) cancelCreateSketch(stores);
      if (measuring || sectioning || printing || overhanging || thickening || customizing) {
        session.getState().setTool(undefined);
      }
      dialog?.cancel();
      void platform.plugins
        .bytes(pluginFeature.plugin.id)
        .then((bytes) =>
          preparePluginAttachment({
            plugin: pluginFeature.plugin,
            bytes,
            doc: store.getState().doc,
            projects: platform.projects,
          }),
        )
        .then(() => dialog?.startSpec(pluginFeature.spec))
        .catch((error: unknown) =>
          notify('error', error instanceof Error ? error.message : String(error)),
        );
      return;
    }
    if (isRepeatable(tool)) setLastTool(tool);
    // P5-05: Record and Stop (ADR-0073 §4): the document is the record, so recording is only
    // where the timeline stood, and Stop writes what was added after it.
    if (tool === 'recordMacro') {
      if (mode !== 'model') return;
      const { features, timelineMarker } = store.getState().doc;
      macro.getState().start(timelineMarker, features.length);
      return;
    }
    if (tool === 'stopMacro') {
      const stopped = macro.getState().stop();
      if (stopped === undefined) return;
      void macroCode(store.getState().doc, stopped).then(setRecorded);
      return;
    }
    // P4-06: Import picks the file first (its bytes go with the design), then
    // opens its dialog, which previews what the file holds.
    if (tool === 'importBody' || tool === 'canvas') {
      if (mode !== 'model') return;
      if (picking) cancelCreateSketch(stores);
      if (measuring || sectioning || printing || overhanging || thickening || customizing) {
        session.getState().setTool(undefined);
      }
      dialog?.cancel();
      if (tool === 'canvas') startCanvasRef.current();
      else startImportRef.current();
      return;
    }
    // A feature dialog's command opens it (P2-05); another tool (not Parameters) ends it.
    const spec = specForCommand(dialogs, tool);
    if (spec) {
      if (mode === 'model') {
        if (picking) cancelCreateSketch(stores);
        if (measuring || sectioning || printing || overhanging || thickening || customizing)
          session.getState().setTool(undefined);
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
    } else if (tool === PROJECT_TOOL || tool === INTERSECT_TOOL) {
      if (mode !== 'sketch') return;
      if (activeTool === tool) session.getState().setTool(undefined);
      else {
        host?.stop();
        session.getState().setTool(tool);
      }
    } else if (tool === 'finishSketch') finishSketch(stores);
    else if (tool === 'export') setModelExport({});
    else if (tool === 'slicer') {
      if (platform.openInSlicer) setModelExport({ slicer: true });
    } else if (tool === MEASURE_TOOL) {
      if (mode !== 'model') return;
      if (measuring) session.getState().setTool(undefined);
      else {
        if (picking) cancelCreateSketch(stores);
        session.getState().setTool(MEASURE_TOOL);
      }
    } else if (tool === SECTION_TOOL) {
      if (mode !== 'model') return;
      if (picking) cancelCreateSketch(stores);
      // A flat face selected in the model takes the section at once, like Create Sketch (P3-09).
      const selected = session.getState().selection;
      const face = selected.length === 1 ? selected[0] : undefined;
      if (face && readTopology(face)?.kind === 'face') {
        session.getState().setTool(SECTION_TOOL);
        void section.pickFace(face);
      } else session.getState().setTool(sectioning ? undefined : SECTION_TOOL);
    } else if (tool === PRINT_INFO_TOOL) {
      if (mode !== 'model') return;
      if (picking) cancelCreateSketch(stores);
      session.getState().setTool(printing ? undefined : PRINT_INFO_TOOL);
    } else if (tool === CUSTOMIZER_TOOL) {
      if (mode !== 'model') return;
      if (picking) cancelCreateSketch(stores);
      session.getState().setTool(customizing ? undefined : CUSTOMIZER_TOOL);
    } else if (tool === TOLERANCE_TOOL) {
      if (mode !== 'model') return;
      if (picking) cancelCreateSketch(stores);
      session.getState().setTool(tolerancing ? undefined : TOLERANCE_TOOL);
    } else if (tool === OVERHANG_TOOL) {
      if (mode !== 'model') return;
      if (overhanging) session.getState().setTool(undefined);
      else {
        if (picking) cancelCreateSketch(stores);
        overhang.start();
        session.getState().setTool(OVERHANG_TOOL);
      }
    } else if (tool === THICKNESS_TOOL) {
      if (mode !== 'model') return;
      if (thickening) session.getState().setTool(undefined);
      else {
        if (picking) cancelCreateSketch(stores);
        thickness.start();
        session.getState().setTool(THICKNESS_TOOL);
      }
    } else if (tool === IMPORT_DRAWING_TOOL) {
      // P4-06: the tool opens the file dialog, then its panel (ADR-0066 §1).
      if (mode !== 'sketch' || !host) {
        notify('info', DRAWING_IMPORT_UNAVAILABLE);
        return;
      }
      if (activeTool === tool) host.stop();
      else void pickDrawing({ files: platform.files, host, notify });
    } else if (tool === 'exportSketch' && activeSketchId) {
      // Profiles selected in the open sketch are offered first (P1-13).
      featureActions.exportSketch(activeSketchId);
    } else if (isSketchTool(tool) && host) {
      if (activeTool === tool) host.stop();
      else host.start(tool);
    }
  };
  // P4-06: Import picks a model file, stores its bytes with the design and opens
  // the dialog, which previews what the file holds (ADR-0066 §0, §2).
  exportScriptRef.current = () => {
    const { doc: current } = store.getState();
    void designCode(current).then((code) => {
      const name = scriptFileName(current.name);
      platform.files.download(new Blob([code], { type: 'text/plain' }), name);
      notify('success', `Exported ${name}.`);
    });
  };
  startImportRef.current = () => {
    if (mode !== 'model') return;
    if (picking) cancelCreateSketch(stores);
    if (measuring || sectioning || printing || overhanging || thickening || customizing) {
      session.getState().setTool(undefined);
    }
    dialog?.cancel();
    void pickImportFile({
      files: platform.files,
      projects: platform.projects,
      store,
      notify,
    }).then((pending) => {
      if (pending) dialog?.start(IMPORT_TYPE);
    });
  };
  // P4-06: Canvas picks an image, stores its bytes with the design and opens
  // its dialog, which previews the picture on its plane (ADR-0066 §5).
  startCanvasRef.current = () => {
    void pickCanvasFile({
      files: platform.files,
      projects: platform.projects,
      store,
      notify,
    }).then((pending) => {
      if (pending) dialog?.start(CANVAS_TYPE);
    });
  };
  runRef.current = run;
  startTutorialRef.current = startTutorial;
  // P6-03: a plugin command (ADR-0077 §5). An open dialog or panel ends first, so the
  // features land at the marker as the timeline shows it.
  runPluginRef.current = (command) => {
    if (mode !== 'model' || !kernel?.runPluginCommand) return;
    if (picking) cancelCreateSketch(stores);
    dialog?.cancel();
    const selected = selectionRefs(session.getState().selection, model.getState().bodies);
    void runPluginCommand({
      command,
      kernel: kernel as PluginCommandKernel,
      plugins: platform.plugins,
      store,
      selection: selected,
    }).then((outcome) => notify(outcome.ok ? 'success' : 'error', outcome.message));
  };
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
    else if (
      projecting ||
      measuring ||
      sectioning ||
      printing ||
      overhanging ||
      thickening ||
      customizing
    )
      session.getState().setTool(undefined);
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
  // An origin plane (`origin:xy`) or a construction plane (its feature's ID, P3-05).
  const pickPlane = (plane: string) => {
    const ref: GeomRef = { kind: 'plane', id: plane };
    if (redefining) redefineTo(redefining, ref);
    else createSketchOn(stores, ref);
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
        hasDialog: (type) => dialogs.get(type) !== undefined || type === 'plugin',
        fixFeature: (id, issues) => {
          if (picking) cancelCreateSketch(stores);
          return dialog?.edit(id, { fix: issues }) ?? false;
        },
        redefinePlane: (id) => startRedefineRef.current(id),
      }),
    [stores, notify, session, dialog, dialogs, picking],
  );
  // The timeline's groups (P4-09, ADR-0065 §2) and the picked chips it shares with the
  // marking menu. Both are session state: nothing here is saved or undoable.
  const groups = useMemo(() => createGroupActions(store, notify), [store, notify]);
  const timelineSelection = useMemo<TimelineSelectionStore>(
    () => createTimelineSelectionStore(),
    [],
  );
  // The marker never rests inside a folded group (ADR-0065 §2): landing in one opens it,
  // amended into the step that moved the marker, so undo takes the opening with it.
  useEffect(() => {
    const command = openGroupAtMarker(doc);
    if (command) store.getState().amend(command);
  }, [doc, store]);
  // A recompute's first new error goes into the notification history (P3-13).
  const featureActionsRef = useRef(featureActions);
  featureActionsRef.current = featureActions;
  useEffect(
    () =>
      watchRecomputeErrors({
        store,
        model,
        notify,
        edit: (id) => featureActionsRef.current.edit(id),
        canEdit: (id) => {
          const { features, timelineMarker } = store.getState().doc;
          const index = features.findIndex((f) => f.id === id);
          const feature = features[index];
          return !!feature && featureActionsRef.current.canEdit(feature, index, timelineMarker);
        },
      }),
    [store, model, notify],
  );

  // Every active, unsuppressed, shown sketch on a known plane is drawn (the open one even if
  // hidden), in its status colours. Profiles are shaded (P1-11) unless the palette hides them.
  // The pointer on a sketch's chip or browser row highlights it (P1-12).
  const status = useHostState(host, (s) => s.status);
  // The pictures a canvas draws are this project's: they go when it closes, like
  // the attachment resolver's (ADR-0061 §3, ADR-0066 §5). The page is keyed by
  // project, so another one mounts afresh.
  useEffect(() => {
    return () => {
      forgetCanvasImages();
    };
  }, []);
  // The two points a canvas calibration marked, drawn in the view (ADR-0066 §5).
  const calibrationPoints = useStore(calibrationStore, (s) => s.points);
  // A box's first corner is marked the same way (P4-12); only one of the two is ever running.
  const cornerPoints = useStore(cornersStore, (s) => s.points);
  const calibration = calibrationPoints.length > 0 ? calibrationPoints : cornerPoints;
  // An open feature dialog's picks are what the view shows selected (a revolve's axis line,
  // the bodies in the browser).
  const shownSelection = dialogItems ?? selection;
  // A dialog picking sketch points (a hole's) has the view draw every shown sketch's points.
  const pickingSketchPoints = useMemo(() => {
    const field = dialogOpen?.spec.fields.find((f) => f.name === dialogOpen.pickField);
    return field?.kind === 'selection' && field.sketchPoints === true;
  }, [dialogOpen]);
  // The pointer on a group chip's row highlights every member (P4-09, ADR-0065 §2); the session
  // holds one hover, so a hovered member highlights its whole group.
  const hoveredFeatures = useMemo(() => hoveredFeatureIds(doc, hover), [doc, hover]);
  // The ghosts of lost geometry (P4-12): of the hovered chip, the feature whose Fix References
  // dialog is open and the feature picked in the timeline; not of every feature at once.
  const pickedChips = useStore(timelineSelection, (s) => s.chips);
  // A sketch's Fix References is the Redefine Plane prompt.
  const fixingId =
    dialogOpen?.mode === 'edit' && dialogOpen.note !== undefined ? dialogOpen.id : redefining;
  const ghosts = useMemo(
    () =>
      ghostsOf(doc.features, featureStatuses, [
        ...hoveredFeatures,
        ...(fixingId ? [fixingId] : []),
        ...pickedChips,
      ]),
    [doc.features, featureStatuses, hoveredFeatures, fixingId, pickedChips],
  );
  const sketches = useMemo(() => {
    const out: SketchDrawing[] = [];
    doc.features.forEach((feature, index) => {
      if (index >= doc.timelineMarker || feature.suppressed) return;
      const active = feature.id === activeSketchId;
      if (!active && !isFeatureVisible(feature)) return;
      const sketch = readSketch(feature);
      // Origin planes have fixed frames; a face's follows the face (P2-09).
      const frame =
        sketch && sketchFrame(feature.id, sketch.plane, sketchReports, constructionReports);
      if (sketch && frame) {
        out.push({
          id: feature.id,
          name: feature.name,
          frame,
          data: sketch.data,
          active,
          highlight: hoveredFeatures.has(feature.id),
          status: active ? status?.entities : undefined,
          // Curves picked in model mode (P2-03).
          ...(!active && pickingSketchPoints && { showPoints: true }),
          ...(!active && {
            hoverEntity: sketchEntityIdsIn([hover], feature.id)[0],
            selectedEntities: sketchEntityIdsIn(shownSelection, feature.id),
          }),
          ...(showProfiles && {
            profiles: sketchProfiles(sketch.data, fontsVersion),
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
    hoveredFeatures,
    shownSelection,
    pickingSketchPoints,
    sketchReports,
    constructionReports,
    fontsVersion,
  ]);
  // Shown construction planes, axes and points the kernel has reported (P3-05); the one a dialog
  // edits is drawn as its preview instead.
  const editedId = dialogOpen?.mode === 'edit' ? dialogOpen.id : undefined;
  const constructionDrawings = useMemo(() => {
    const out: ConstructionDrawing[] = [];
    doc.features.forEach((feature, index) => {
      if (index >= doc.timelineMarker || feature.suppressed || !isFeatureVisible(feature)) return;
      if (feature.id === editedId) return;
      const report = constructionReports[feature.id];
      if (report) out.push({ id: feature.id, name: feature.name, report });
    });
    return out;
  }, [doc.features, doc.timelineMarker, constructionReports, editedId]);
  // Canvas images to draw: every shown canvas the kernel has reported a frame
  // for, minus the one the open dialog edits (its draft is the preview).
  const canvasList = useMemo(
    () => canvasDrawings(doc, canvasReports, editedId ? { skip: editedId } : {}),
    [doc, canvasReports, editedId],
  );
  const activeSketch = doc.features.find((f) => f.id === activeSketchId);
  const sketchPlane = sketches.find((s) => s.active)?.frame;
  // The right-click marking menu (P3-11): offered while nothing else owns the pointer.
  const runningTool = useMemo(
    () =>
      drawing && host
        ? { label: TOOLS[activeTool as ToolId]?.label ?? 'Tool', cancel: () => host.stop() }
        : undefined,
    [drawing, host, activeTool],
  );
  const { menu: viewMenu, popover: appearancePopover } = useViewMenu({
    mode,
    session,
    viewport,
    commands,
    bodies: bodyList,
    bodyActions,
    features: doc.features,
    featureActions,
    groupActions: groups,
    pickedChips: useStore(timelineSelection, (s) => s.chips),
    enabled:
      mode === 'model'
        ? !picking && !dialogOpen && !projecting && !measuring && !section.choosing
        : !projecting && sketchPlane !== undefined,
    radial: markingStyle.radial,
    overrides: markingSlots.overrides,
    ...(runningTool && { runningTool }),
  });
  // In the model, with no command running, the view picks bodies, sketch curves and
  // profiles (P2-03). Sketch mode keeps its own picking (the tool host).
  const sessionSelect = useModelSelection(
    session,
    bodies,
    mode === 'model' && !picking && !dialogOpen,
  );
  // While Measure runs, two plain clicks pick two things to measure between.
  const measureSelect = useMemo(
    () => (measuring && sessionSelect ? createMeasureSelect(session, sessionSelect) : undefined),
    [measuring, sessionSelect, session],
  );
  const modelSelect = section.choosing
    ? undefined
    : dialogOpen && mode === 'model'
      ? dialogPlanePick(dialog, dialogOpen)
        ? undefined
        : dialog?.select
      : projecting
        ? project.select
        : (measureSelect ?? sessionSelect);
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
        // Auto-project (P6-07): a drawing tool may snap to a body edge or vertex.
        modelSnap: true,
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
            hover: hover?.kind === 'plane' ? hover.id : undefined,
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
        : (section.planePicker ?? dialogPlanes),
    [picking, hover, session, kernel, dialogPlanes, section.planePicker],
  );

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-bg text-ink">
      <AppBar
        store={store}
        autosave={autosave}
        file={fileActions}
        tabs={<ToolbarTabs mode={mode} tab={toolbarTab} onTab={setToolbarTab} />}
        theme={choice}
        onThemeChange={setChoice}
        onSearch={openSearch}
        onTutorial={startTutorial}
        onDocs={(page) => platform.openDocs(docsPath(page))}
        viewport={viewport}
        onCustomizeMarking={() => setMarkingDialog(true)}
      />
      <TutorialCard tutorial={tutorial} />
      <ViewportHint
        show={
          doc.features.length === 0 &&
          mode === 'model' &&
          activeTool === undefined &&
          !tutorial.open &&
          !dialogOpen
        }
      />
      <Toolbar
        mode={mode}
        tab={toolbarTab}
        activeTool={
          picking
            ? 'sketch'
            : drawing ||
                projecting ||
                measuring ||
                sectioning ||
                printing ||
                overhanging ||
                thickening ||
                customizing
              ? (activeTool as ToolId)
              : dialogOpen && typeof dialogOpen.spec.command === 'string'
                ? dialogOpen.spec.command
                : undefined
        }
        onRun={run}
        ready={ready}
        hidden={macroHidden}
        pluginItems={pluginItems}
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
            bodies={browserBodies}
            bodyActions={bodyActions}
            selectedBodies={selectedBodies}
            statuses={featureStatuses}
            recomputeFinished={recomputeFinished}
            onPickBody={
              modelSelect
                ? (id, toggle) => modelSelect.onClick({ kind: 'body', id }, toggle)
                : undefined
            }
            onHoverBody={(id) => modelSelect?.onHover(id ? { kind: 'body', id } : undefined)}
            {...(sectionEntry && { section: sectionEntry })}
            {...(overhang.state && {
              overhang: {
                label: `Overhangs · ${overhang.downLabel} · ${
                  overhang.degrees === undefined ? '?' : Math.round(overhang.degrees)
                }°`,
                on: overhang.state.on,
                active: overhanging,
                onToggle: () => overhang.setOn(!overhang.state?.on),
                onEdit: openOverhang,
                onRemove: () => {
                  overhang.remove();
                  if (overhanging) session.getState().setTool(undefined);
                },
              },
            })}
            {...(thickness.state && {
              thickness: {
                label: `Wall thickness · ${
                  thickness.min === undefined
                    ? '?'
                    : formatQuantity(thickness.min, LENGTH, {
                        ...doc.settings,
                        precision: 1,
                      })
                }`,
                on: thickness.state.on,
                active: thickening,
                onToggle: () => thickness.setOn(!thickness.state?.on),
                onEdit: openThickness,
                onRemove: () => {
                  thickness.remove();
                  if (thickening) session.getState().setTool(undefined);
                },
              },
            })}
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
        <ModelProgress model={model} store={store} collapsed={browser.collapsed} />
        <ViewportBoundary>
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
              construction={constructionDrawings}
              ghosts={ghosts}
              canvases={canvasList}
              calibration={calibration}
              sketchInput={sketchInput}
              commandRunning={drawing || picking || projecting || measuring || section.choosing}
              onStopCommand={stopCommand}
              hover={hover}
              selection={dialogItems ?? selection}
              modelSelect={modelSelect}
              preview={preview}
              viewMenu={viewMenu}
              sectionClips={section.clips}
              {...(section.box?.value && {
                sectionBox: { box: section.box.value, on: section.box.state.on },
              })}
              {...(overhang.summary !== undefined && {
                overhang: { view: overhang.view, summary: overhang.summary },
              })}
              {...(thickness.summary !== undefined && {
                thickness: { thin: thickness.shading, summary: thickness.summary },
              })}
            >
              {dialogOpen && dialog && (
                <DialogOverlay
                  controller={dialog}
                  viewport={viewport}
                  settings={doc.settings}
                  bodies={shownBodies}
                />
              )}
              {thickness.spot && (
                <ThicknessOverlay
                  spot={thickness.spot}
                  viewport={viewport}
                  settings={doc.settings}
                  {...(section.clips.length > 0 && { clip: section.clips })}
                />
              )}
              {sectioning && (
                <SectionOverlay tool={section} viewport={viewport} settings={doc.settings} />
              )}
              {measuring && measured.measurement?.pair && (
                <MeasureOverlay
                  pair={measured.measurement.pair}
                  viewport={viewport}
                  settings={doc.settings}
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
                  onDelete={remove}
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
                  onDelete={remove}
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
                  fonts={fontPicker}
                  notify={notify}
                />
              )}
              {/* The Text tool's panel (P4-03): it takes the selection panel's place. */}
              {mode === 'sketch' && activeTool === 'text' && textOpen && (
                <TextPanel store={store} host={host} fonts={fontPicker} notify={notify} />
              )}
              {/* The Import Drawing tool's panel (P4-06), likewise. */}
              {mode === 'sketch' && activeTool === IMPORT_DRAWING_TOOL && importOpen && (
                <ImportDrawingPanel store={store} host={host} />
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
            {appearancePopover}
          </Suspense>
        </ViewportBoundary>
        {picking && (
          <PlanePrompt
            session={session}
            {...(redefining && {
              title: 'Redefine Plane',
              hint: `Pick a plane or a flat face for ${doc.features.find((f) => f.id === redefining)?.name ?? 'the sketch'}, in the view or here.`,
            })}
            planes={constructionDrawings
              .filter((c) => c.report.kind === 'plane')
              .map((c) => ({ id: c.id, name: c.name }))}
            onPick={pickPlane}
            onCancel={() => cancelCreateSketch(stores)}
          />
        )}
        {dialog && <FeatureDialog controller={dialog} settings={doc.settings} />}
        {sectioning && (
          <SectionPanel
            tool={section}
            settings={doc.settings}
            planeLabel={sectionPlane}
            constructionPlanes={constructionDrawings
              .filter((c) => c.report.kind === 'plane')
              .map((c) => ({ id: c.id, name: c.name }))}
            onClose={() => session.getState().setTool(undefined)}
          />
        )}
        {printing && (
          <PrintInfoPanel info={printInfo} onClose={() => session.getState().setTool(undefined)} />
        )}
        {tolerancing && (
          <TolerancePanel
            tolerance={tolerance}
            onClose={() => session.getState().setTool(undefined)}
          />
        )}
        {overhanging && (
          <OverhangPanel
            tool={overhang}
            settings={doc.settings}
            onClose={() => session.getState().setTool(undefined)}
          />
        )}
        {thickening && (
          <WallThicknessPanel
            tool={thickness}
            settings={doc.settings}
            onClose={() => session.getState().setTool(undefined)}
          />
        )}
        {customizing && (
          <CustomizerPanel
            tool={customizer}
            onOpenParameters={() => setParametersOpen(true)}
            onClose={() => session.getState().setTool(undefined)}
          />
        )}
        {measuring && (
          <MeasurePanel
            state={measured}
            settings={doc.settings}
            others={selection.length - measured.count}
            onClear={() => session.getState().clearSelection()}
            onClose={() => session.getState().setTool(undefined)}
          />
        )}
        {mode === 'sketch' && activeSketch && (
          <PanelColumn>
            {projecting && isProjectTool(activeTool) && (
              <ProjectPanel
                tool={activeTool}
                linked={keepLinked}
                onLinked={setKeepLinked}
                onDone={() => session.getState().setTool(undefined)}
              />
            )}
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
        {/* Clear of the open dialog's column: a toast over its OK button swallows the
            click (the "Sketch1 is hidden…" notice lives 12 seconds). */}
        {toasts && !(mode === 'sketch' && activeSketch) && (
          <Toasts place="view" clearRight={dialogOpen ? DIALOG_COLUMN : undefined} {...toasts} />
        )}
      </main>
      <Timeline
        store={store}
        activeSketch={activeSketch?.name}
        actions={featureActions}
        groups={groups}
        selection={timelineSelection}
        viewport={viewport}
        model={model}
        session={session}
        editing={dialogOpen?.mode === 'edit' ? dialogOpen.id : undefined}
        pluginHint={pluginHint}
        macro={macro}
        selectionSize={
          measured.measurement?.bbox && sizeText(measured.measurement.bbox, doc.settings)
        }
      />
      <MacroDialog
        recorded={recorded}
        store={store}
        notify={notify}
        onClose={() => setRecorded(undefined)}
      />
      <OverConstrainedDialog host={host} />
      <ParametersDialog
        store={store}
        apply={apply}
        open={parametersOpen}
        onOpenChange={setParametersOpen}
      />
      <CustomizeMarkingMenu
        open={markingDialog}
        onClose={() => setMarkingDialog(false)}
        overrides={markingSlots.overrides}
        commands={markingCommands}
        assign={markingSlots.assign}
        resetAll={markingSlots.resetAll}
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
        openInSlicer={platform.openInSlicer}
        installedSlicers={platform.installedSlicers}
        notify={notify}
        onClose={() => setModelExport(undefined)}
      />
      <ExportSketchDialog
        store={store}
        request={exportRequest}
        files={platform.files}
        onClose={() => setExportRequest(undefined)}
      />
      <VersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        ctx={versionContext}
        notify={notify}
        beforeRestore={endTransaction}
        onOpenCopy={(id) => navigate(projectHref(id))}
      />
      <PluginsDialog
        open={pluginsOpen}
        onOpenChange={setPluginsOpen}
        plugins={plugins}
        files={platform.files}
        inDesign={inDesign}
        onUpdate={updatePlugin}
      />
    </div>
  );
}
