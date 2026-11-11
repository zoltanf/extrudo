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
  type BodyId,
  CommandError,
  type DocumentStore,
  type ModelStore,
  type SessionStore,
  type SheetId,
  type SheetViewId,
  sheetBaseFrame,
  sheetPaperSize,
  type Vec3,
} from '@extrudo/core';
import type { DisplayList } from '@extrudo/io';
import { type BodyMesh, shownBodies } from '@extrudo/kernel';
import { layoutSheet, SHEET_FONTS, type SheetViewLines } from '@extrudo/sheets';
import { Hand, Maximize, MousePointer2, Trash2, ZoomIn } from 'lucide-react';
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
import { Button, IconButton } from '../design-system';
import type { Preferences } from '../platform/preferences';
import { ensureUiFonts, fontsStore } from '../sketch/fonts';
import { basis } from '../viewport/camera';
import { ProgressCube } from '../viewport/ModelProgress';
import { WAITING_AFTER_MS } from '../viewport/progressRules';
import type { ViewportStore } from '../viewport/store';
import { changeSheet, finishDrawing, renameSheet, type SheetModeStores } from './mode';
import { SheetCanvas, type SheetCanvasControl } from './SheetCanvas';
import { SheetSetup } from './SheetSetup';
import { type BaseViewChoices, BaseViewPanel, SheetViewCard } from './SheetViewCard';
import {
  deleteTargets,
  moveTargets,
  type SheetTarget,
  selectedTargets,
  sheetSelection,
  targetName,
} from './selection';
import { sheetViewNotice, sheetViewWant, sheetViewWants } from './viewLines';
import {
  NO_SHEET_VIEWS,
  type SheetViewsKernel,
  type SheetViewsState,
  sheetViewRunner,
} from './viewRunner';
import { changeSheetView, lookingFromChoices, placeBaseView } from './views';

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
}

const noSubscribe = () => () => {};
const noViews = () => NO_SHEET_VIEWS;
const BASE_VIEW_DEFAULTS: BaseViewChoices = { looking: 'front', scale: undefined, style: 'hidden' };

/** The right column's width and gap, px (as wide as the sketch palette). */
const COLUMN = 256 + 12;

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
  useEffect(() => runner?.want(wants), [runner, wants]);
  // Leaving the drawing: the run stops before the next view (its results stay cached).
  useEffect(() => () => runner?.want([]), [runner]);
  const views = useSyncExternalStore<SheetViewsState>(
    runner?.subscribe ?? noSubscribe,
    runner?.get ?? noViews,
  );

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
      void runner
        .peek(sheetViewWant('placing', frame, shownBodies(doc, bodyIds)))
        .then((lines) => live && setPreview(lines));
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
      session.getState().setTool(undefined);
      session.getState().select(sheetSelection([`view:${result.id}`]));
    },
    [sheet, lookingChoice, choices, stores, session, notify],
  );

  useEffect(() => {
    void ensureUiFonts(SHEET_FONTS);
    // Orbit means nothing on a sheet: the floating bar has Pan and Zoom only.
    if (viewport.getState().tool === 'orbit') viewport.getState().setTool(undefined);
  }, [viewport]);

  // What is on screen is what is exported: the same list `sheetsToPdf` writes.
  const list = useMemo<DisplayList | undefined>(() => {
    if (!sheet) return undefined;
    void fonts;
    try {
      return layoutSheet(sheet, { name: doc.name, sheets, views: views.lines });
    } catch {
      // The sheet fonts are still loading: the paper is drawn bare until they are in.
      return undefined;
    }
  }, [sheet, sheets, doc.name, fonts, views.lines]);

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
  const one = selected.length === 1 ? selected[0] : undefined;
  const selectedView = one?.startsWith('view:')
    ? sheet.views.find((v) => v.id === one.slice(5))
    : undefined;
  const navTool = tool === 'pan' || tool === 'zoom' ? tool : undefined;
  return (
    <div className="absolute inset-0 z-[5]" data-sheet-workspace="">
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
        notices={notices}
        onMove={(targets, dx, dy) => {
          try {
            moveTargets(store, targets, dx, dy);
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
          className="min-w-12 border-l border-line pl-2 text-center font-mono text-xs text-muted tabular-nums"
        />
      </nav>
      <div className="pointer-events-none absolute top-3 right-3 bottom-3 z-10 flex w-64 flex-col gap-2 overflow-y-auto [scrollbar-width:none]">
        {placingTool ? (
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
            notify={notify}
            onDelete={remove}
            onFinish={() => finishDrawing(stores)}
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
 * (ADR-0105), with how far the run is and Cancel, which stops it before the next view.
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
  const running = progress !== undefined && shown;
  if (!running && !cancelled) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-sheet-views-progress={running ? 'running' : 'cancelled'}
      className="pointer-events-none absolute top-3 z-10 flex items-center gap-2.5 rounded-control border border-line bg-panel px-3 py-2 shadow-raised"
      style={{ left: left + 12 }}
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
