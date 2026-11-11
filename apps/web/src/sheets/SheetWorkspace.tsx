/**
 * The drawing's centre (P6-24, plan §3.1, §4): the sheet in place of the 3D view, its
 * floating bar (select, pan, zoom, fit, zoom %) and the right column: Sheet Setup and
 * Finish Drawing while nothing is selected, the title block's fields when it is, a view's
 * card for one view, Base View's panel while that tool runs, else a card for the
 * selection (what it is, Delete).
 *
 * The open sheet's views are drawn from the model (S2) by the project's view runner
 * (`viewRunner.ts`): quick lines first, then exact ones, one view at a time; the notice at
 * the top left shows the run (after a moment, like other kernel waits) with Cancel. A lazy chunk of its own: it holds
 * `@extrudo/sheets`, whose text needs the shaper (`@extrudo/sketch/text`), which never
 * reaches the entry chunk (ADR-0058 §4). The 3D view stays mounted underneath, covered.
 */
import {
  addSheetItem,
  type BodyId,
  CommandError,
  type DocumentStore,
  type ModelStore,
  newId,
  type SessionStore,
  type Sheet,
  type SheetAnchors,
  type SheetId,
  type SheetItem,
  type SheetItemChanges,
  type SheetItemId,
  type SheetStickyColor,
  type SheetViewId,
  sheetBaseFrame,
  sheetItemView,
  sheetPaperSize,
  sheetStandardFrom,
  updateSheetItem,
  type Vec2,
  type Vec3,
} from '@extrudo/core';
import type { DisplayItem, DisplayList, DisplayText } from '@extrudo/io';
import { type BodyMesh, shownBodies } from '@extrudo/kernel';
import {
  layoutSheet,
  layoutSheetLeader,
  measureSheetDimension,
  SHEET_FONTS,
  SHEET_NOTE,
  SHEET_STICKY,
  SHEET_TEXT_SIZE,
  type SheetViewLines,
  sheetItemStatus,
  sheetMargin,
  sheetViewScale,
} from '@extrudo/sheets';
import { Hand, Magnet, Maximize, MousePointer2, StickyNote, Trash2, ZoomIn } from 'lucide-react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useStore } from 'zustand';
import { Button, IconButton, MenuItem, MenuSeparator, PointMenu, ToolIcon } from '../design-system';
import type { Preferences } from '../platform/preferences';
import { ensureUiFonts, fontsStore } from '../sketch/fonts';
import { basis } from '../viewport/camera';
import { ProgressCube } from '../viewport/ModelProgress';
import { WAITING_AFTER_MS } from '../viewport/progressRules';
import type { ViewportStore } from '../viewport/store';
import {
  DIMENSION_DEFAULTS,
  type DimensionChoices,
  hitPickable,
  type SheetHit,
  sheetPickables,
  toSheet,
} from './dimensionTool';
import { faceHit } from './faceHit';
import { changeSheet, finishDrawing, renameSheet, type SheetModeStores } from './mode';
import { NOTE_MOST, type NoteTool, noteAccepts, noteItem, noteStep, noteWhole } from './noteTools';
import { RepickHandles } from './RepickHandles';
import { SheetCanvas, type SheetCanvasControl } from './SheetCanvas';
import {
  DimensionCard,
  DimensionOverlay,
  DimensionPanel,
  dimensionChanges,
  PreviewItems,
} from './SheetDimensionCard';
import {
  CentreCard,
  LeaderCard,
  type NoteToolId,
  NoteToolPanel,
  StickyCard,
  TextCard,
} from './SheetNoteCard';
import { SheetSetup } from './SheetSetup';
import { type SheetTextEdit, SheetTextEditor } from './SheetTextEditor';
import {
  type BaseViewChoices,
  BaseViewPanel,
  ProjectedViewPanel,
  SheetViewCard,
} from './SheetViewCard';
import {
  deleteTargets,
  moveTargets,
  type SheetTarget,
  selectedTargets,
  sheetSelection,
  targetBoxes,
  targetName,
  viewDeltas,
} from './selection';
import {
  drawnItems,
  isAnchored,
  type SheetItemRow,
  sheetItemsStore,
  useSheetAnchors,
} from './sheetAnchors';
import { dimensionRows, guidePath, rowOf, type SnapRow, snapPoint } from './snap';
import { type DimensionKernel, useDimensionTool } from './useDimensionTool';
import { type PickToolSpec, type PickToolState, usePickTool } from './usePickTool';
import { useProjectedView } from './useProjectedView';
import { baseViewOf, sheetViewNotice, sheetViewWant, sheetViewWants } from './viewLines';
import {
  NO_SHEET_VIEWS,
  type SheetViewsKernel,
  type SheetViewsState,
  sheetViewRunner,
} from './viewRunner';
import {
  changeSheetView,
  fitScale,
  lookingFromChoices,
  placeBaseView,
  placedAt,
  rescaleSheetView,
  runSheetCommand,
  scaleText,
} from './views';

export interface SheetWorkspaceProps {
  stores: SheetModeStores;
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  sheetId: SheetId;
  /** The browser's width while shown, px: the sheet is centred in the room beside it. */
  browserInset: number;
  control: RefObject<SheetCanvasControl | undefined>;
  nameField: RefObject<HTMLInputElement | null>;
  preferences: Preferences;
  notify(tone: 'info' | 'error', text: string): void;
  onMenu?: (at: { x: number; y: number }) => void;
  /** The model at the marker: which bodies the views draw. */
  model: ModelStore<BodyMesh>;
  /** The project's kernel; without it the views stay frames. */
  kernel?: SheetViewsKernel;
  /**
   * The kernel's anchors and reference calls; without them dimensions and notes are drawn
   * detached and nothing can be picked.
   */
  anchorsKernel?: DimensionKernel;
}

const noSubscribe = () => () => {};
const noViews = () => NO_SHEET_VIEWS;
const BASE_VIEW_DEFAULTS: BaseViewChoices = { looking: 'front', scale: undefined, style: 'hidden' };

/** The right column's width and gap, px (as wide as the sketch palette). */
const COLUMN = 256 + 12;

/** A new sticky note's size, mm. */
const STICKY_SIZE = [60, 40] as const;

/** The anchored notes tools by their session tool ID. */
const NOTE_TOOLS: Readonly<Record<string, NoteTool>> = {
  sheetLeader: 'leader',
  sheetCentreMark: 'centreMark',
  sheetCentreLine: 'centreLine',
};

/** An anchored note tool's spec for the shared pick tool. */
function noteSpec(tool: NoteTool): PickToolSpec {
  return {
    accepts: (hit, picks) => noteAccepts(tool, hit, picks),
    whole: (hit, picks) => noteWhole(tool, hit, picks),
    most: NOTE_MOST[tool],
    placed: tool === 'leader' ? 'click' : 'now',
    label:
      tool === 'centreMark' ? 'Centre mark' : tool === 'centreLine' ? 'Centre line' : 'Leader note',
    item: (id, picks, at) => noteItem(tool, id, picks, at),
    ...(tool === 'leader' && {
      preview: (sheet: Sheet, item: SheetItem, anchors: SheetAnchors) =>
        item.kind === 'leader' ? { items: layoutSheetLeader(sheet, item, anchors) } : { items: [] },
    }),
  };
}

/** Each anchored note tool's spec: made once, so the pick tool keeps its picks. */
const NOTE_SPECS: Readonly<Record<NoteTool, PickToolSpec>> = {
  leader: noteSpec('leader'),
  centreMark: noteSpec('centreMark'),
  centreLine: noteSpec('centreLine'),
};

/** The first line drawn for display key `key`: where typing it in place starts. */
function firstRun(items: readonly DisplayItem[] | undefined, key: string): DisplayText | undefined {
  return items?.find((i): i is DisplayText => i.type === 'text' && i.key === key);
}

/** The undo step of a typed new item. */
const TYPED_LABEL: Readonly<Record<SheetTextEdit['kind'], string>> = {
  text: 'Text',
  leader: 'Leader note',
  sticky: 'Sticky note',
};

/** A sheet place is kept to a hundredth of a mm (as a move's). */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The words of a moved note's row and status text (a dimension's are the status bar's own). */
const MOVED: Partial<Record<SheetItem['kind'], string>> = {
  leader: 'This note moved to matching geometry.',
  centreMark: 'This centre mark moved to a matching circle.',
  centreLine: 'This centre line moved to matching edges.',
};

export default function SheetWorkspace({
  stores,
  store,
  session,
  viewport,
  sheetId,
  browserInset,
  control,
  nameField,
  preferences,
  notify,
  onMenu,
  model,
  kernel,
  anchorsKernel,
}: SheetWorkspaceProps) {
  const doc = useStore(store, (s) => s.doc);
  const sheets = doc.sheets ?? [];
  const sheet = sheets.find((s) => s.id === sheetId);
  const preset = useStore(viewport, (s) => s.preset);
  const tool = useStore(viewport, (s) => s.tool);
  const fonts = useStore(fontsStore, (s) => s.version);
  const zoomLabel = useRef<HTMLOutputElement>(null);
  const selection = useStore(session, (s) => s.selection);
  const hover = useStore(session, (s) => s.hover);
  const selected = useMemo(() => selectedTargets(selection), [selection]);
  const hovered = hover?.kind === 'sheet' ? hover.id : undefined;
  const activeTool = useStore(session, (s) => s.activeTool);
  const modelBodies = useStore(model, (s) => s.bodies);
  const bodyIds = useMemo(() => Object.keys(modelBodies) as BodyId[], [modelBodies]);

  // The views drawn from the model (S2): what the open sheet's views ask for, kept drawn.
  const runner = useMemo(() => (kernel ? sheetViewRunner(kernel) : undefined), [kernel]);
  const wants = useMemo(
    () => (sheet ? sheetViewWants(doc, sheet, bodyIds) : []),
    [doc, sheet, bodyIds],
  );
  // While the model is computed the views wait (the kernel has nothing, or is replacing it).
  const computing = useStore(model, (st) => st.status === 'idle' || st.status === 'computing');
  useEffect(() => runner?.want(wants, computing), [runner, wants, computing]);
  // The items' anchors (S3): resolved after the model, a view or an item changes, the lost
  // ones kept where they were drawn; an item not asked about yet waits (`drawnItems`).
  const recomputed = useStore(model, (st) => st.features);
  const resolved = useSheetAnchors(anchorsKernel, sheet, recomputed, computing);
  const { anchors, asked } = resolved;
  // Leaving the drawing: the run stops before the next view (its results stay cached).
  useEffect(() => () => runner?.want([]), [runner]);
  const views = useSyncExternalStore<SheetViewsState>(
    runner?.subscribe ?? noSubscribe,
    runner?.get ?? noViews,
  );

  const one = selected.length === 1 ? selected[0] : undefined;
  const selectedItem = one?.startsWith('item:')
    ? sheet?.items.find((i) => i.id === one.slice(5))
    : undefined;
  const dimension = selectedItem?.kind === 'dimension' ? selectedItem : undefined;
  const rows = useStore(sheetItemsStore, (s) => (s.sheet === sheet?.id ? s.rows : undefined));
  const itemRow = selectedItem ? rows?.get(selectedItem.id) : undefined;
  const dimensionRow = dimension ? itemRow : undefined;

  // The tools that pick the model (Dimension, S3; Leader Note, Centre Mark, Centreline, S4)
  // and picking a lost or moved item's geometry again: what on the sheet a click can take
  // (exact, current lines only).
  const dimensionTool = activeTool === 'sheetDimension';
  const noteTool = activeTool ? NOTE_TOOLS[activeTool] : undefined;
  const repicking =
    !dimensionTool &&
    !noteTool &&
    selectedItem !== undefined &&
    sheetItemView(selectedItem) !== undefined &&
    (itemRow?.state === 'detached' || itemRow?.state === 'moved');
  const scaleOf = useCallback(
    (id: SheetViewId) => {
      const view = sheet?.views.find((v) => v.id === id);
      const [a, b] = view && sheet ? sheetViewScale(sheet, view) : [1, 1];
      return a / b;
    },
    [sheet],
  );
  const picking = dimensionTool || noteTool !== undefined || repicking;
  const pickables = useMemo(
    () =>
      sheet && picking
        ? sheetPickables(sheet, views.geometry, views.pending, (v) => scaleOf(v.id))
        : [],
    [sheet, picking, views.geometry, views.pending, scaleOf],
  );
  // What the pointer is over: an edge, a vertex or an outline; with `faces`, else a face (a
  // leader note's dot).
  const hitEdges = useCallback(
    (p: Vec2, tolerance: number, only?: SheetViewId) => hitPickable(pickables, p, tolerance, only),
    [pickables],
  );
  const hitWithFaces = useCallback(
    (p: Vec2, tolerance: number, only?: SheetViewId): SheetHit | undefined =>
      hitPickable(pickables, p, tolerance, only) ??
      (sheet
        ? faceHit(sheet, views.geometry, views.pending, scaleOf, modelBodies, p, only)
        : undefined),
    [pickables, sheet, views.geometry, views.pending, scaleOf, modelBodies],
  );
  const [dimensionChoices, setDimensionChoices] = useState<DimensionChoices>(DIMENSION_DEFAULTS);
  const toolArgs = {
    sheet,
    units: doc.settings.units,
    pickables,
    scaleOf,
    kernel: anchorsKernel,
    stores,
    notify,
    merge: resolved.merge,
  };
  const dimensioning = useDimensionTool({
    ...toolArgs,
    active: dimensionTool,
    hitAt: hitEdges,
    choices: dimensionChoices,
  });

  // Typing on the sheet (S4): a new text, leader note or sticky note, or one double-clicked.
  const [editing, setEditing] = useState<{
    edit: SheetTextEdit;
    /** A new item from its typed text; absent when an item is edited. */
    make?: (text: string) => SheetItem;
    /** A new leader note's reports, merged when it is made. */
    reports?: SheetAnchors;
    /** What is drawn while typing (a new leader's arrow), sheet mm. */
    shows?: DisplayItem[];
  }>();
  // Whether the press now under way began while typing: its click only finishes the typing.
  const pressedWhileTyping = useRef(false);
  const leaderTool = usePickTool({
    ...toolArgs,
    active: noteTool === 'leader',
    hitAt: hitWithFaces,
    spec: NOTE_SPECS.leader,
    onPlaced: (item, reports) => {
      if (!sheet || item.kind !== 'leader') return;
      const drawn = layoutSheetLeader({ ...sheet, items: [item] }, item, reports);
      // The placeholder's first line: where the typed text starts.
      const run = firstRun(drawn, `item:${item.id}`);
      if (!run) return;
      setEditing({
        edit: { kind: 'leader', baseline: [run.at[0], run.at[1]], size: SHEET_NOTE.text, text: '' },
        make: (text) => ({ ...item, text }),
        reports,
        shows: drawn.filter((d) => d.type !== 'text'),
      });
    },
  });
  const centreMarkTool = usePickTool({
    ...toolArgs,
    active: noteTool === 'centreMark',
    hitAt: hitEdges,
    spec: NOTE_SPECS.centreMark,
  });
  const centreLineTool = usePickTool({
    ...toolArgs,
    active: noteTool === 'centreLine',
    hitAt: hitEdges,
    spec: NOTE_SPECS.centreLine,
  });
  const picker: PickToolState | undefined = dimensionTool
    ? dimensioning
    : noteTool === 'leader'
      ? leaderTool
      : noteTool === 'centreMark'
        ? centreMarkTool
        : noteTool === 'centreLine'
          ? centreLineTool
          : undefined;
  // The Text and Sticky Note tools' choices for the next one, kept for the session.
  const [textSize, setTextSize] = useState<number>();
  const [stickyColor, setStickyColor] = useState<SheetStickyColor>('yellow');
  // Sticky notes shown on screen (the floating bar's switch; never stored).
  const [showStickies, setShowStickies] = useState(true);
  // Snapping (the floating bar's Snap, on by default) and a placing tool's guides.
  const [snapOn, setSnapOn] = useState(true);
  const [placeGuides, setPlaceGuides] = useState('');
  const pickedPoints = useMemo(() => {
    const out: [number, number][] = [];
    for (const pick of picker?.picks ?? []) {
      const view = sheet?.views.find((v) => v.id === pick.view);
      if ((pick.kind === 'point' || pick.kind === 'face') && pick.p && view) {
        const [x, y] = toSheet(view, scaleOf(view.id), pick.p);
        out.push([x, y]);
      }
    }
    return out;
  }, [picker?.picks, sheet, scaleOf]);
  const waiting = useMemo(
    () =>
      (sheet?.views ?? [])
        .filter((v) => !views.geometry.get(v.id)?.exact || views.pending.has(v.id))
        .map((v) => v.name),
    [sheet, views.geometry, views.pending],
  );
  const lost = useMemo(
    () => [...(rows?.values() ?? [])].some((r) => r.state === 'detached'),
    [rows],
  );
  const selectedView = one?.startsWith('view:')
    ? sheet?.views.find((v) => v.id === one.slice(5))
    : undefined;
  // Projected View (S2): from the selected view, or the one Base View just placed.
  const projected = useProjectedView({
    active: activeTool === 'projectedView',
    sheet,
    doc,
    bodies: bodyIds,
    runner,
    geometry: views.geometry,
    selectedView,
    stores,
    session,
    notify,
  });
  // A view's own menu (right-click on it): Projected View from This, Fit Scale, Delete.
  const [viewMenu, setViewMenu] = useState<{ id: SheetViewId; at: { x: number; y: number } }>();

  // Base View (S2): its choices and the frame's lines, drawn quick before the click.
  const placingTool = activeTool === 'baseView';
  const [choices, setChoices] = useState<BaseViewChoices>(BASE_VIEW_DEFAULTS);
  // The camera is read when the card or the tool shows (a new selection, the tool started).
  // biome-ignore lint/correctness/useExhaustiveDependencies: those two are the moments to read it.
  const looking = useMemo(() => {
    const b = basis(viewport.getState().view);
    const camera: { direction: Vec3; up: Vec3 } = {
      direction: [-b.back.x, -b.back.y, -b.back.z],
      up: [b.up.x, b.up.y, b.up.z],
    };
    return lookingFromChoices(doc, camera);
  }, [doc, viewport, placingTool, selection]);
  const lookingChoice = looking.find((c) => c.value === choices.looking) ?? looking[0];
  const [preview, setPreview] = useState<SheetViewLines>();
  useEffect(() => {
    setPreview(undefined);
    if (!placingTool || !runner || !lookingChoice) return;
    let live = true;
    try {
      const frame = sheetBaseFrame(lookingChoice.from.direction, lookingChoice.from.up);
      const want = sheetViewWant('placing', frame, shownBodies(doc, bodyIds));
      // The quick lines at once, then the exact ones (the quick bounds can be off).
      void (async () => {
        const quick = await runner.peek(want);
        if (live && quick) setPreview(quick);
        const exact = await runner.peek(want, true);
        if (live && exact) setPreview(exact);
      })();
    } catch {
      // A degenerate direction: the frame is a placeholder's.
    }
    return () => {
      live = false;
    };
  }, [placingTool, runner, lookingChoice, doc, bodyIds]);
  const placeScale = choices.scale ?? sheet?.scale ?? [1, 1];
  const onPlace = useCallback(
    (at: [number, number]) => {
      if (!sheet || !lookingChoice) return;
      const result = placeBaseView(stores, sheet, {
        from: lookingChoice.from,
        name: lookingChoice.name,
        at,
        ...(choices.scale && { scale: choices.scale }),
        style: choices.style,
      });
      if ('error' in result) {
        notify('error', result.error);
        return;
      }
      // The tool carries on as Projected View from the new view (plan §4.5).
      session.getState().select(sheetSelection([`view:${result.id}`]));
      projected.start(result.id);
    },
    [sheet, lookingChoice, choices, stores, session, notify, projected],
  );

  useEffect(() => {
    void ensureUiFonts(SHEET_FONTS);
    // Orbit means nothing on a sheet: the floating bar has Pan and Zoom only.
    if (viewport.getState().tool === 'orbit') viewport.getState().setTool(undefined);
  }, [viewport]);

  // What is on screen is what is exported: the same list `sheetsToPdf` writes (with the
  // floating bar's sticky notes switch off, without them).
  const list = useMemo<DisplayList | undefined>(() => {
    if (!sheet) return undefined;
    void fonts;
    const shown = showStickies
      ? sheet
      : { ...sheet, items: sheet.items.filter((i) => i.kind !== 'sticky') };
    try {
      return layoutSheet(drawnItems(shown, asked), {
        name: doc.name,
        sheets,
        views: views.lines,
        ...(anchors && { anchors }),
        units: doc.settings.units,
      });
    } catch {
      // The sheet fonts are still loading: the paper is drawn bare until they are in.
      return undefined;
    }
  }, [
    sheet,
    sheets,
    doc.name,
    doc.settings.units,
    fonts,
    views.lines,
    anchors,
    asked,
    showStickies,
  ]);

  // What a placed or dragged item snaps to: the targets' boxes and the dimensions' rows.
  const boxes = useMemo(() => (list ? targetBoxes(list) : new Map()), [list]);
  const dimensionTargets = useMemo(
    () =>
      new Set(
        (sheet?.items ?? []).filter((i) => i.kind === 'dimension').map((i) => `item:${i.id}`),
      ),
    [sheet],
  );
  const snapRows = useMemo(() => dimensionRows(list, dimensionTargets), [list, dimensionTargets]);

  // Each item's text and state for the browser's rows and the status bar (plan §4.6).
  useEffect(() => {
    if (!sheet) return;
    const rows = new Map<SheetItemId, SheetItemRow>();
    const drawn = drawnItems(sheet, asked);
    const options = { units: doc.settings.units };
    for (const item of drawn.items) {
      if (!isAnchored(item)) continue;
      const status = sheetItemStatus(sheet, item, anchors, options);
      const text =
        item.kind === 'dimension'
          ? measureSheetDimension(sheet, item, anchors, options).text
          : undefined;
      const moved = status.state === 'moved' && !status.message ? MOVED[item.kind] : undefined;
      // A lost note says the kernel's reason when it has one (a deleted, suppressed or failed
      // feature), as a dimension does (`measureSheetDimension`).
      const lostWhy =
        status.state === 'detached' && item.kind !== 'dimension'
          ? anchors?.[item.id]?.find((r) => r.status === 'detached' && r.message)?.message
          : undefined;
      rows.set(item.id, {
        ...status,
        ...(moved && { message: moved }),
        ...(lostWhy && { message: lostWhy }),
        ...(text !== undefined && { text }),
      });
    }
    sheetItemsStore.setState({ sheet: sheet.id, rows });
  }, [sheet, anchors, asked, doc.settings.units]);
  useEffect(() => () => sheetItemsStore.setState({ sheet: undefined, rows: new Map() }), []);

  // What the screen says under a view: being drawn, a body gone, a mesh body (plan §4.6).
  const notices = useMemo(() => {
    const out = new Map<string, string>();
    for (const view of sheet?.views ?? []) {
      const id = view.id as SheetViewId;
      const geometry = views.geometry.get(id);
      const error = views.errors.get(id);
      const text = error
        ? "This view couldn't be drawn."
        : geometry
          ? sheetViewNotice(doc, geometry)
          : runner && !views.cancelled
            ? 'Drawing the view…'
            : undefined;
      if (text) out.set(`view:${id}`, text);
    }
    return out;
  }, [sheet, views, doc, runner]);

  // What the document no longer has (undone, deleted) leaves the selection.
  useEffect(() => {
    if (!sheet || selected.length === 0) return;
    const exists = (t: SheetTarget) =>
      t === 'title-block'
        ? sheet.titleBlock !== undefined
        : t.startsWith('view:')
          ? sheet.views.some((v) => v.id === t.slice(5))
          : sheet.items.some((i) => i.id === t.slice(5));
    const left = selected.filter(exists);
    if (left.length !== selected.length) session.getState().select(sheetSelection(left));
  }, [sheet, selected, session]);

  if (!sheet) return null;
  const paper = sheetPaperSize(sheet);
  const fail = (error: unknown) => {
    if (!(error instanceof CommandError)) throw error;
    notify('error', error.message);
  };
  const remove = () => {
    try {
      deleteTargets(store, selected);
      session.getState().clearSelection();
    } catch (error) {
      fail(error);
    }
  };
  const insets = { left: browserInset, right: COLUMN, top: 0, bottom: 56 };
  /** Fit Scale: the largest standard scale at which the view's base view fits inside the border. */
  const fitView = (id: SheetViewId) => {
    const view = sheet.views.find((v) => v.id === id);
    const base = view && baseViewOf(sheet, view);
    const bounds = base && views.geometry.get(base.id)?.bounds;
    if (!base || !bounds) {
      notify('info', 'The view has no lines to fit yet.');
      return;
    }
    const m = sheetMargin(sheet);
    const scale = fitScale(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      paper.width - 2 * m - 20,
      paper.height - 2 * m - 20,
    );
    const same = scaleText(scale) === scaleText(sheet.scale);
    const problem = rescaleSheetView(
      stores,
      sheet,
      base.id,
      same ? undefined : scale,
      bounds,
      'Fit scale',
    );
    if (problem) notify('error', problem);
  };
  /** Bodies dropped from the browser: a front view of them alone at the sheet's scale. */
  const dropBodies = (ids: string[], point: [number, number]) => {
    const chosen = ids.filter((id) => id in doc.bodies) as BodyId[];
    if (chosen.length === 0 || !runner) return;
    const from = sheetStandardFrom('front');
    void runner
      .peek(sheetViewWant('placing', sheetBaseFrame(from.direction, from.up), chosen), true)
      .then((lines) => {
        const now = store.getState().doc.sheets?.find((s) => s.id === sheet.id);
        if (!now) return;
        const [a, b] = now.scale;
        const result = placeBaseView(stores, now, {
          from,
          name: chosen.length === 1 ? (doc.bodies[chosen[0] as BodyId]?.name ?? 'Front') : 'Front',
          at: placedAt(point, lines?.bounds, a / b),
          bodies: chosen,
        });
        if ('error' in result) notify('error', result.error);
        else session.getState().select(sheetSelection([`view:${result.id}`]));
      });
  };
  const navTool = tool === 'pan' || tool === 'zoom' ? tool : undefined;

  // Typing on the sheet (S4): Enter, or leaving the field, makes the new item (one undo step)
  // or writes the edited text (one step, none when unchanged). Blank text makes or changes
  // nothing.
  const commitText = (text: string) => {
    const now = editing;
    setEditing(undefined);
    if (!now || text.trim() === '') return;
    if (now.make) {
      const item = now.make(text);
      const error = runSheetCommand(stores, {
        ...addSheetItem({ sheet: sheet.id, item }),
        label: TYPED_LABEL[now.edit.kind],
      });
      if (error) notify('error', error);
      else if (now.reports) resolved.merge(now.reports);
      return;
    }
    const was = sheet.items.find((i) => i.id === now.edit.id);
    if (!was || !('text' in was) || was.text === text) return;
    const error = runSheetCommand(stores, {
      ...updateSheetItem({ id: was.id, changes: { text } as SheetItemChanges }),
      label: 'Edit text',
    });
    if (error) notify('error', error);
  };
  const endText = () => setEditing(undefined);
  /** A click of a tool while typing (the one that ends it) only finishes typing. */
  const busyTyping = () => editing !== undefined || pressedWhileTyping.current;
  /** Text and Sticky Note: a click starts a new one there, typed in place. */
  const placeText = (point: Vec2) => {
    if (busyTyping()) return;
    const id = newId<SheetItemId>();
    const at: [number, number] = [round2(point[0]), round2(point[1])];
    if (activeTool === 'sheetText') {
      const size = textSize ?? SHEET_TEXT_SIZE;
      setEditing({
        edit: { kind: 'text', baseline: [at[0], at[1] + size], size, text: '' },
        make: (text) => ({
          kind: 'text',
          id,
          at,
          text,
          ...(textSize !== undefined && { size: textSize }),
        }),
      });
      return;
    }
    const { padding, text: size } = SHEET_NOTE;
    const color = stickyColor;
    setEditing({
      edit: {
        kind: 'sticky',
        baseline: [at[0] + padding, at[1] + padding + size],
        size,
        note: { at, size: STICKY_SIZE, fill: SHEET_STICKY[color].fill, padding },
        text: '',
      },
      make: (text) => ({
        kind: 'sticky',
        id,
        at,
        size: [STICKY_SIZE[0], STICKY_SIZE[1]],
        text,
        ...(color !== 'yellow' && { color }),
      }),
    });
  };
  /** A double-click: a text, a leader note's text or a sticky note is typed where it is. */
  const openTarget = (target: string) => {
    const item = target.startsWith('item:')
      ? sheet.items.find((i) => i.id === target.slice(5))
      : undefined;
    if (!item) return;
    session.getState().select(sheetSelection([target]));
    if (item.kind === 'text' || item.kind === 'leader') {
      const size = item.kind === 'text' ? (item.size ?? SHEET_TEXT_SIZE) : SHEET_NOTE.text;
      const run = firstRun(list?.items, target);
      const baseline: Vec2 | undefined = run
        ? [run.at[0], run.at[1]]
        : item.kind === 'text'
          ? [item.at[0], item.at[1] + size]
          : undefined;
      if (!baseline) return;
      setEditing({
        edit: {
          kind: item.kind,
          id: item.id,
          baseline,
          size,
          text: item.text,
          ...(item.kind === 'text' && item.width !== undefined && { width: item.width }),
        },
      });
    } else if (item.kind === 'sticky') {
      const { padding, text: size } = SHEET_NOTE;
      setEditing({
        edit: {
          kind: 'sticky',
          id: item.id,
          baseline: [item.at[0] + padding, item.at[1] + padding + size],
          size,
          note: {
            at: item.at,
            size: item.size,
            fill: SHEET_STICKY[item.color ?? 'yellow'].fill,
            padding,
          },
          text: item.text,
        },
      });
    }
  };
  const textTool = activeTool === 'sheetText' || activeTool === 'sheetSticky';
  /**
   * Where a tool places at `p` with snapping: a text's or note's corner, or a dimension's or
   * leader's text while it follows the pointer (a dimension's row 10 mm from the others').
   */
  const placeAt = (p: Vec2, tolerance: number): [number, number] => {
    const placing = picker
      ? picker.preview !== undefined && picker.pointer !== undefined
      : textTool;
    if (!snapOn || !placing) {
      if (placeGuides) setPlaceGuides('');
      return [p[0], p[1]];
    }
    // The preview's row was laid out at the tool's last point: it moves with the pointer.
    let row: SnapRow | undefined;
    const run = picker?.preview?.items.find((i): i is DisplayText => i.type === 'text');
    const was = picker?.pointer;
    const r = dimensionTool && run ? rowOf(run) : undefined;
    if (r && was)
      row = { axis: r.axis, at: r.at + (r.axis === 'x' ? p[0] - was[0] : p[1] - was[1]) };
    const snapped = snapPoint(p, [...boxes.values()], tolerance, row, [...snapRows.values()]);
    const d = guidePath(snapped.guides);
    if (d !== placeGuides) setPlaceGuides(d);
    return snapped.point;
  };
  const pointerTool = picker
    ? {
        onPoint: (p: [number, number], tolerance: number) =>
          picker.onPoint(placeAt(p, tolerance), tolerance),
        onClick: (p: [number, number], tolerance: number) => {
          if (busyTyping()) return;
          picker.onClick(picker.preview ? placeAt(p, tolerance) : p, tolerance);
          setPlaceGuides('');
        },
        onLeave: () => {
          picker.onLeave();
          setPlaceGuides('');
        },
      }
    : textTool
      ? {
          onPoint: (p: [number, number], tolerance: number) => {
            if (!editing) placeAt(p, tolerance);
          },
          onClick: (p: [number, number], tolerance: number) => {
            placeText(placeAt(p, tolerance));
            setPlaceGuides('');
          },
          onLeave: () => setPlaceGuides(''),
        }
      : undefined;
  const overlay = picker ? (
    <>
      <DimensionOverlay tool={picker} points={pickedPoints} />
      {editing?.shows && <PreviewItems items={editing.shows} />}
    </>
  ) : repicking && selectedItem && anchorsKernel && sheetItemView(selectedItem) ? (
    <RepickHandles
      key={selectedItem.id}
      sheet={sheet}
      item={selectedItem}
      anchors={anchors}
      hitAt={selectedItem.kind === 'leader' ? hitWithFaces : hitEdges}
      scale={scaleOf(sheetItemView(selectedItem) as SheetViewId)}
      control={control}
      kernel={anchorsKernel}
      stores={stores}
      notify={notify}
    />
  ) : undefined;
  const changeItem =
    (id: SheetItemId) =>
    (changes: SheetItemChanges, label: string): string | undefined =>
      runSheetCommand(stores, { ...updateSheetItem({ id, changes }), label });
  const noteToolId = activeTool && (textTool || noteTool) ? (activeTool as NoteToolId) : undefined;
  const noteStepText = editing
    ? 'Type the text.'
    : noteTool && picker
      ? picker.busy
        ? 'Reading the pick…'
        : noteStep(noteTool, picker.picks)
      : activeTool === 'sheetText'
        ? 'Click where the text starts, then type.'
        : 'Click where the note goes, then type.';
  return (
    <div
      className="absolute inset-0 z-[5]"
      data-sheet-workspace=""
      onPointerDownCapture={() => {
        pressedWhileTyping.current = editing !== undefined;
      }}
    >
      <SheetCanvas
        list={list}
        sheetId={sheet.id}
        paper={paper}
        preset={preset}
        tool={navTool}
        insets={insets}
        control={control}
        zoomLabel={zoomLabel}
        {...(onMenu && { onMenu })}
        selected={selected}
        {...(hovered && { hovered })}
        nameOf={(target) => targetName(sheet, target)}
        onHover={(target) =>
          session.getState().setHover(target ? { kind: 'sheet', id: target } : undefined)
        }
        onSelect={(targets, mode) => {
          if (targets.length === 0 && mode === 'replace') session.getState().clearSelection();
          else session.getState().select(sheetSelection(targets), mode);
        }}
        {...(placingTool && {
          placing: {
            ...(preview && { lines: preview }),
            k: placeScale[0] / placeScale[1],
            onPlace,
          },
        })}
        {...(projected.placing && { placing: projected.placing })}
        {...(pointerTool && { pointer: pointerTool })}
        {...(overlay && { overlay })}
        {...(editing && {
          editor: (
            <SheetTextEditor
              key={editing.edit.id ?? 'new'}
              edit={editing.edit}
              onCommit={commitText}
              onCancel={endText}
            />
          ),
        })}
        onOpen={openTarget}
        {...(snapOn && { snap: { rows: snapRows } })}
        {...(placeGuides && pointerTool && { guides: placeGuides })}
        movesOf={(targets, dx, dy, free) => {
          const moves = new Map<string, readonly [number, number]>(
            targets.map((t) => [t, [dx, dy] as const]),
          );
          for (const [id, move] of viewDeltas(sheets, targets, dx, dy, free)) {
            moves.set(`view:${id}`, move);
          }
          return moves;
        }}
        onTargetMenu={(target, at) => {
          session.getState().select(sheetSelection([target]));
          setViewMenu({ id: target.slice(5) as SheetViewId, at });
        }}
        onDropBodies={dropBodies}
        notices={notices}
        onMove={(targets, dx, dy, free) => {
          try {
            moveTargets(store, targets, dx, dy, free);
            return true;
          } catch (error) {
            fail(error);
            return false;
          }
        }}
      />
      {runner && (
        <SheetViewsNotice
          state={views}
          left={browserInset}
          onCancel={() => runner.cancel()}
          onRetry={() => runner.retry()}
        />
      )}
      <PointMenu
        at={viewMenu?.at}
        onClose={() => setViewMenu(undefined)}
        label={`${sheet.views.find((v) => v.id === viewMenu?.id)?.name ?? 'View'} menu`}
      >
        <MenuItem
          icon={<ToolIcon name="projected-view" category="create" size={14} />}
          shortcut="P"
          onSelect={() => viewMenu && projected.start(viewMenu.id)}
        >
          Projected View from This
        </MenuItem>
        <MenuItem icon={<Maximize size={14} />} onSelect={() => viewMenu && fitView(viewMenu.id)}>
          Fit Scale
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 size={14} />}
          shortcut="Del"
          onSelect={() => {
            if (!viewMenu) return;
            try {
              deleteTargets(store, [`view:${viewMenu.id}`]);
              session.getState().clearSelection();
            } catch (error) {
              fail(error);
            }
          }}
        >
          Delete
        </MenuItem>
      </PointMenu>
      <nav
        aria-label="Sheet navigation"
        className="absolute bottom-3 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line px-2 py-1 backdrop-blur-[6px] transition-[left] duration-(--x-normal) ease-ui"
        style={{
          left: `calc((100% - ${COLUMN}px) / 2 + ${browserInset}px / 2)`,
          background: 'color-mix(in srgb, var(--x-raised) 85%, transparent)',
        }}
      >
        <IconButton
          label="Select"
          hint="Back to the pointer: Pan and Zoom stop. Esc does too."
          pressed={navTool === undefined}
          onClick={() => viewport.getState().setTool(undefined)}
        >
          <MousePointer2 size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Pan"
          hint="Drag with the left button to move the sheet. Esc to stop."
          pressed={navTool === 'pan'}
          onClick={() => viewport.getState().setTool(navTool === 'pan' ? undefined : 'pan')}
        >
          <Hand size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Zoom"
          hint="Drag up or down with the left button to zoom. Esc to stop."
          pressed={navTool === 'zoom'}
          onClick={() => viewport.getState().setTool(navTool === 'zoom' ? undefined : 'zoom')}
        >
          <ZoomIn size={16} strokeWidth={1.75} />
        </IconButton>
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton
          label="Fit"
          shortcut="F6"
          hint="Fit the whole sheet in the view."
          onClick={() => control.current?.fit()}
        >
          <Maximize size={16} strokeWidth={1.75} />
        </IconButton>
        <output
          ref={zoomLabel}
          data-sheet-zoom=""
          aria-label="Zoom level"
          className="min-w-12 border-x border-line px-2 text-center font-mono text-xs text-muted tabular-nums"
        />
        <IconButton
          label="Snap"
          hint="Moved and placed items snap to other items' edges and middles, dimensions to rows 10 mm apart."
          pressed={snapOn}
          onClick={() => setSnapOn((on) => !on)}
        >
          <Magnet size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Show sticky notes"
          hint="Sticky notes on the sheet: shown or hidden on screen. The export has its own switch."
          pressed={showStickies}
          onClick={() => setShowStickies((on) => !on)}
        >
          <StickyNote size={16} strokeWidth={1.75} />
        </IconButton>
      </nav>
      <div className="pointer-events-none absolute top-3 right-3 bottom-3 z-10 flex w-64 flex-col gap-2 overflow-y-auto [scrollbar-width:none]">
        {dimensionTool ? (
          <DimensionPanel
            doc={doc}
            sheet={sheet}
            tool={dimensioning}
            waiting={waiting}
            lost={lost}
            value={dimensionChoices}
            onChange={setDimensionChoices}
          />
        ) : noteToolId ? (
          <NoteToolPanel
            tool={noteToolId}
            doc={doc}
            step={noteStepText}
            waiting={waiting}
            textSize={textSize}
            onTextSize={setTextSize}
            color={stickyColor}
            onColor={setStickyColor}
          />
        ) : activeTool === 'projectedView' ? (
          <ProjectedViewPanel
            {...(projected.parent && { parent: projected.parent.name })}
            {...(projected.next && { side: projected.next })}
            drawing={projected.drawing}
          />
        ) : placingTool ? (
          <BaseViewPanel
            doc={doc}
            sheet={sheet}
            choices={looking}
            value={choices}
            onChange={setChoices}
            drawing={runner !== undefined && preview === undefined}
          />
        ) : selectedView ? (
          <SheetViewCard
            key={selectedView.id}
            doc={doc}
            sheet={sheet}
            view={selectedView}
            bodies={bodyIds}
            choices={looking}
            {...(views.geometry.get(selectedView.id)?.bounds && {
              bounds: views.geometry.get(selectedView.id)?.bounds,
            })}
            change={(changes, label) => changeSheetView(stores, selectedView.id, changes, label)}
            rescale={(scale) =>
              rescaleSheetView(
                stores,
                sheet,
                selectedView.id,
                scale,
                views.geometry.get(selectedView.id)?.bounds,
              )
            }
            notify={notify}
            onDelete={remove}
            onFinish={() => finishDrawing(stores)}
          />
        ) : dimension ? (
          <DimensionCard
            key={dimension.id}
            doc={doc}
            sheet={sheet}
            item={dimension}
            row={dimensionRow}
            change={(changes, label) =>
              runSheetCommand(stores, {
                ...updateSheetItem({
                  id: dimension.id,
                  changes: dimensionChanges(changes) as SheetItemChanges,
                }),
                label,
              })
            }
            onDelete={remove}
          />
        ) : selectedItem?.kind === 'text' ? (
          <TextCard
            key={selectedItem.id}
            doc={doc}
            item={selectedItem}
            change={changeItem(selectedItem.id)}
            onDelete={remove}
          />
        ) : selectedItem?.kind === 'leader' ? (
          <LeaderCard
            key={selectedItem.id}
            sheet={sheet}
            item={selectedItem}
            row={itemRow}
            change={changeItem(selectedItem.id)}
            onDelete={remove}
          />
        ) : selectedItem?.kind === 'sticky' ? (
          <StickyCard
            key={selectedItem.id}
            doc={doc}
            item={selectedItem}
            change={changeItem(selectedItem.id)}
            onDelete={remove}
          />
        ) : selectedItem?.kind === 'centreMark' || selectedItem?.kind === 'centreLine' ? (
          <CentreCard
            key={selectedItem.id}
            sheet={sheet}
            item={selectedItem}
            row={itemRow}
            onDelete={remove}
          />
        ) : selected.length > 0 && !(selected.length === 1 && selected[0] === 'title-block') ? (
          <SelectionCard
            names={selected.map((t) => targetName(sheet, t))}
            deletable={selected.some((t) => t !== 'title-block')}
            onDelete={remove}
          />
        ) : (
          <SheetSetup
            titleBlockOnly={selected[0] === 'title-block'}
            doc={doc}
            sheet={sheet}
            change={(changes, label) => changeSheet(stores, sheet.id, changes, label)}
            rename={(name) => renameSheet(stores, sheet.id, name)}
            preferences={preferences}
            notify={notify}
            onFinish={() => finishDrawing(stores)}
            nameField={nameField}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The right column for a selection on the sheet (not the title block alone): what is
 * selected, Delete, and how to move it. The properties of each kind come with its slice.
 */
function SelectionCard({
  names,
  deletable,
  onDelete,
}: {
  names: readonly string[];
  deletable: boolean;
  onDelete(): void;
}) {
  const title = names.length === 1 ? (names[0] ?? 'Item') : `${names.length} selected`;
  return (
    <section
      aria-label="Selection"
      className="pointer-events-auto flex shrink-0 flex-col gap-3 rounded-dialog border border-line p-3 shadow-raised backdrop-blur-[6px]"
      style={{ background: 'color-mix(in srgb, var(--x-raised) 92%, transparent)' }}
    >
      <h2 className="truncate text-base font-semibold">{title}</h2>
      {names.length > 1 && (
        <ul className="flex flex-col gap-0.5 text-sm">
          {names.map((name, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two texts may read the same.
            <li key={i} className="truncate">
              {name}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">
        Drag to move. The arrow keys nudge by 1 mm, with Shift by 10 mm. Esc clears the selection.
      </p>
      {deletable && (
        <Button onClick={onDelete}>
          <Trash2 size={14} strokeWidth={1.75} />
          Delete
          <span className="ml-auto font-mono text-xs text-muted">Del</span>
        </Button>
      )}
    </section>
  );
}

/**
 * The views being drawn (plan §4.2): shown after a moment like other kernel waits
 * (ADR-0105), at the top middle of the sheet (the model's notice keeps the top left), with
 * how far the run is and Cancel, which stops it before the next view.
 * After a cancel it says the views are out of date and offers to draw them.
 *
 * Test hooks: `[data-sheet-views-progress]` (`running` or `cancelled`), the buttons
 * "Cancel drawing the views" and "Draw the views".
 */
function SheetViewsNotice({
  state,
  left,
  onCancel,
  onRetry,
}: {
  state: SheetViewsState;
  left: number;
  onCancel(): void;
  onRetry(): void;
}) {
  const { progress, cancelled } = state;
  const since = progress?.since;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (since === undefined) {
      setShown(false);
      return;
    }
    const lasted = Date.now() - since;
    if (lasted > WAITING_AFTER_MS) {
      setShown(true);
      return;
    }
    setShown(false);
    const timer = setTimeout(() => setShown(true), WAITING_AFTER_MS - lasted + 1);
    return () => clearTimeout(timer);
  }, [since]);
  // A run Draw started shows at once: the cancelled notice turns into it without a gap.
  const running = progress !== undefined && (shown || progress.asked);
  if (!running && !cancelled) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-sheet-views-progress={running ? 'running' : 'cancelled'}
      className="pointer-events-none absolute top-3 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-control border border-line bg-panel px-3 py-2 shadow-raised"
      // At the top middle of the sheet's room: the model's own notice is at the top left.
      style={{ left: `calc((100% - ${COLUMN}px) / 2 + ${left}px / 2)` }}
    >
      <ProgressCube />
      <div className="flex flex-col leading-tight">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-ink">
            {running ? 'Drawing the views' : 'Some views are out of date'}
          </span>
          <Button
            variant="ghost"
            aria-label={running ? 'Cancel drawing the views' : 'Draw the views'}
            onClick={running ? onCancel : onRetry}
            className="pointer-events-auto -my-1 ml-auto h-6 px-2 text-sm"
          >
            {running ? 'Cancel' : 'Draw'}
          </Button>
        </div>
        {running && progress ? (
          <>
            <progress
              value={progress.done}
              max={Math.max(progress.total, 1)}
              aria-label="Views drawn"
              className="mt-1 h-1 w-40 accent-accent"
            />
            <span className="mt-0.5 text-xs text-muted">
              View {Math.min(progress.done + 1, progress.total)} of {progress.total}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted">Cancelled: they show the last lines.</span>
        )}
      </div>
    </div>
  );
}
